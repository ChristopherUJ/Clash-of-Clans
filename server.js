// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 80;

// --- CONFIGURATION ---
const COC_API_KEY = process.env.COC_API_KEY;
const COC_CLAN_TAG = process.env.COC_CLAN_TAG;
if (!COC_API_KEY || !COC_CLAN_TAG) {
    console.error("FATAL ERROR: Make sure COC_API_KEY and COC_CLAN_TAG are set in your .env file.");
    process.exit(1);
}
const COC_API_BASE_URL = 'https://api.clashofclans.com/v1';
const DB_PATH = path.join(__dirname, 'clan_data.db');

// --- DATABASE CONNECTION ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error(err.message); throw err; }
    console.log('Connected to the SQLite database.');

    // --- NEW: Enable Write-Ahead Logging for better concurrency ---
    db.run("PRAGMA journal_mode = WAL;", (err) => {
        if (err) {
            console.error("Failed to enable WAL mode:", err.message);
        } else {
            console.log("WAL mode enabled for the database.");
        }
    });
});

// --- Promise-based wrappers for database calls ---
function dbGet(query, params) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}
function dbAll(query, params) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
}
function dbRun(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            resolve(this);
        });
    });
}

// --- HELPER FUNCTIONS ---
const roleHierarchy = { 'member': 0, 'admin': 1, 'coLeader': 2, 'leader': 3 };
const getRoleName = (apiRole) => ({ member: 'Member', admin: 'Elder', coLeader: 'Co-Leader', leader: 'Leader' }[apiRole] || 'Unknown');
const sanitizeName = (name) => (typeof name === 'string' ? name.replace(/[^a-zA-Z0-9\s.,!?'"#$%&()*+-_=<>@`~[\]{}:;\\|/]/g, '').trim() : '');
const findAchievementValue = (achievements, name) => {
    const achievement = achievements.find(ach => ach.name === name);
    return achievement ? achievement.value : 0;
};

app.use(express.static(__dirname));

// =================================================================
//  ENDPOINT TO UPDATE DATA
// =================================================================
app.get('/update-data', async (req, res) => {
    console.log('Starting data update process...');
    res.status(202).send('Update process started.');

    try {
        const clanRes = await fetch(`${COC_API_BASE_URL}/clans/%23${COC_CLAN_TAG.replace('#', '')}`, {
            headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
        });
        const clanData = await clanRes.json();
        if (!clanData.memberList) throw new Error('Could not fetch clan member list.');

        for (const member of clanData.memberList) {
            const playerRes = await fetch(`${COC_API_BASE_URL}/players/%23${member.tag.replace('#', '')}`, {
                headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
            });
            const playerData = await playerRes.json();
            if (!playerRes.ok) continue;

            const storedPlayer = await dbGet('SELECT * FROM players WHERE tag = ?', [member.tag]);

            let lastSeenActive = new Date().toISOString();
            let highestRole = member.role;
            if (storedPlayer) {
                const donationsChanged = storedPlayer.donations !== playerData.donations;
                const expLevelChanged = storedPlayer.expLevel !== playerData.expLevel;
                if (!donationsChanged && !expLevelChanged) {
                    lastSeenActive = storedPlayer.lastSeenActive;
                }
                if (roleHierarchy[storedPlayer.highestRole] > roleHierarchy[member.role]) {
                    highestRole = storedPlayer.highestRole;
                }
            }

            const upsertSql = `
        INSERT INTO players (tag, name, role, highestRole, townHallLevel, expLevel, trophies, bestTrophies, warStars, donations, donationsReceived, troopDonations, spellDonations, siegeDonations, lastSeenActive)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tag) DO UPDATE SET
          name=excluded.name, role=excluded.role, highestRole=excluded.highestRole, townHallLevel=excluded.townHallLevel,
          expLevel=excluded.expLevel, trophies=excluded.trophies, bestTrophies=excluded.bestTrophies, warStars=excluded.warStars,
          donations=excluded.donations, donationsReceived=excluded.donationsReceived, troopDonations=excluded.troopDonations,
          spellDonations=excluded.spellDonations, siegeDonations=excluded.siegeDonations, lastSeenActive=excluded.lastSeenActive;
      `;
            const params = [
                member.tag, sanitizeName(member.name), member.role, highestRole, playerData.townHallLevel, playerData.expLevel, playerData.trophies,
                playerData.bestTrophies, playerData.warStars, playerData.donations, playerData.donationsReceived,
                findAchievementValue(playerData.achievements, 'Friend in Need'), findAchievementValue(playerData.achievements, 'Sharing is caring'),
                findAchievementValue(playerData.achievements, 'Siege Sharer'), lastSeenActive
            ];
            await dbRun(upsertSql, params);
        }
        console.log('✅ Data update process finished successfully!');
    } catch (error) {
        console.error('❌ An error occurred during the update process:', error);
    }
});

// =================================================================
//  ENDPOINTS TO SERVE CACHED DATA
// =================================================================
app.get('/tracked-clan-data', async (req, res) => {
    console.log("-> Received request for /tracked-clan-data");
    try {
        const sql = "SELECT * FROM players ORDER BY trophies DESC";
        console.log("--> Executing SQL query...");
        const rows = await dbAll(sql, []);
        console.log(`--> Query successful, found ${rows.length} rows.`);

        const responseData = rows.map(player => ({
            tag: player.tag, name: player.name, trophies: player.trophies,
            currentRoleName: getRoleName(player.role), highestRoleName: getRoleName(player.highestRole),
            sortOrder: roleHierarchy[player.highestRole], lastSeenActive: player.lastSeenActive
        }));

        console.log("--> Sending JSON response.");
        res.json(responseData);
    } catch (err) {
        console.error("!!! ERROR in /tracked-clan-data:", err);
        res.status(500).json({ error: 'Failed to read database.' });
    }
});

app.get('/player/:playerTag', async (req, res) => {
    try {
        const sql = "SELECT * FROM players WHERE tag = ?";
        const playerTagWithHash = '#' + req.params.playerTag;
        const row = await dbGet(sql, [playerTagWithHash]);
        if (!row) return res.status(404).json({ error: 'Player not found in database.' });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read database.' });
    }
});

// CWL STATS ENDPOINT
app.get('/cwl-stats', async (req, res) => {
    try {
        // ... (The beginning of the function that fetches data is the same) ...
        const currentClanRes = await fetch(`${COC_API_BASE_URL}/clans/%23${COC_CLAN_TAG.replace('#', '')}`, {
            headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
        });
        const currentClanData = await currentClanRes.json();
        const currentMemberTags = new Set(currentClanData.memberList.map(m => m.tag));
        const groupRes = await fetch(`${COC_API_BASE_URL}/clans/%23${COC_CLAN_TAG.replace('#', '')}/currentwar/leaguegroup`, {
            headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
        });
        const groupData = await groupRes.json();
        if (groupData.reason === 'notInWar') return res.status(404).json({ error: 'The clan is not currently in a Clan War League.' });
        if (!groupData.rounds) return res.status(500).json({ error: 'Could not retrieve CWL rounds.' });
        const warPromises = groupData.rounds.flatMap(round => round.warTags).filter(tag => tag !== '#0')
            .map(warTag => fetch(`${COC_API_BASE_URL}/clanwarleagues/wars/%23${warTag.replace('#', '')}`, {
                headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
            }).then(res => res.json()));
        const allWarData = await Promise.all(warPromises);
        const playerStats = {};
        for (const war of allWarData) {
            if (war.state !== 'inWar' && war.state !== 'warEnded') continue;
            const ourClan = war.clan.tag === `#${COC_CLAN_TAG}` ? war.clan : war.opponent;
            const enemyClan = war.clan.tag !== `#${COC_CLAN_TAG}` ? war.clan : war.opponent;
            for (const member of ourClan.members) {
                if (!playerStats[member.tag]) {
                    playerStats[member.tag] = { tag: member.tag, name: member.name, stars: 0, destruction: 0, attacks: 0, defenses: 0, starsConceded: 0, missedAttacks: 0, warsParticipated: 0 };
                }
                playerStats[member.tag].warsParticipated += 1;
            }
            for (const member of ourClan.members) {
                if (member.attacks) {
                    playerStats[member.tag].attacks += member.attacks.length;
                    for (const attack of member.attacks) {
                        playerStats[member.tag].stars += attack.stars;
                        playerStats[member.tag].destruction += attack.destructionPercentage;
                    }
                }
            }
            if (war.state === 'warEnded') {
                for (const member of ourClan.members) {
                    if (!member.attacks || member.attacks.length === 0) {
                        if (playerStats[member.tag]) playerStats[member.tag].missedAttacks += 1;
                    }
                }
            }
            for (const enemy of enemyClan.members) {
                if (enemy.attacks) {
                    for (const attack of enemy.attacks) {
                        if (playerStats[attack.defenderTag]) {
                            playerStats[attack.defenderTag].defenses += 1;
                            playerStats[attack.defenderTag].starsConceded += attack.stars;
                        }
                    }
                }
            }
        }

        const finalStats = Object.values(playerStats)
            .filter(player => currentMemberTags.has(player.tag))
            .map(p => {
                p.netStars = p.stars - p.starsConceded;
                p.avgDestruction = p.attacks > 0 ? (p.destruction / p.attacks).toFixed(2) : 0;
                // --- NEW: Calculate average stars per attack ---
                p.avgStars = p.attacks > 0 ? (p.stars / p.attacks).toFixed(2) : 0;
                return p;
            }).sort((a, b) => b.netStars - a.netStars);

        // --- NEW: Calculate clan-wide summary stats ---
        const summary = {
            totalAttacks: finalStats.reduce((sum, p) => sum + p.attacks, 0),
            totalMissedAttacks: finalStats.reduce((sum, p) => sum + p.missedAttacks, 0),
            totalStars: finalStats.reduce((sum, p) => sum + p.stars, 0),
        };
        summary.averageStars = summary.totalAttacks > 0 ? (summary.totalStars / summary.totalAttacks).toFixed(2) : 0;

        // --- NEW: Send back an object with both players and summary ---
        res.json({
            players: finalStats,
            summary: summary
        });

    } catch (error) {
        console.error("Error fetching CWL stats:", error);
        res.status(500).json({ error: "Failed to fetch CWL stats." });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
