// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose(); // Import sqlite3

const app = express();
const port = process.env.PORT || 80;

// --- CONFIGURATION ---
const COC_API_KEY = process.env.COC_API_KEY;
const COC_CLAN_TAG = process.env.COC_CLAN_TAG;
if (!COC_API_KEY || !COC_CLAN_TAG) {
    console.error("FATAL ERROR: Secrets not found in .env file.");
    process.exit(1);
}
const COC_API_BASE_URL = 'https://api.clashofclans.com/v1';
const DB_PATH = path.join(__dirname, 'clan_data.db');

// --- DATABASE CONNECTION ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error(err.message);
        throw err;
    }
    console.log('Connected to the SQLite database.');
});

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

            // Check for highest rank promotion
            db.get('SELECT highestRole FROM players WHERE tag = ?', [member.tag], async (err, row) => {
                let highestRole = member.role;
                if (row && roleHierarchy[row.highestRole] > roleHierarchy[member.role]) {
                    highestRole = row.highestRole;
                }

                // Use INSERT ON CONFLICT (UPSERT) to add or update player data
                const upsertSql = `
          INSERT INTO players (tag, name, role, highestRole, townHallLevel, expLevel, trophies, bestTrophies, warStars, donations, donationsReceived, troopDonations, spellDonations, siegeDonations)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tag) DO UPDATE SET
            name=excluded.name, role=excluded.role, highestRole=excluded.highestRole, townHallLevel=excluded.townHallLevel,
            expLevel=excluded.expLevel, trophies=excluded.trophies, bestTrophies=excluded.bestTrophies, warStars=excluded.warStars,
            donations=excluded.donations, donationsReceived=excluded.donationsReceived, troopDonations=excluded.troopDonations,
            spellDonations=excluded.spellDonations, siegeDonations=excluded.siegeDonations;
        `;

                const params = [
                    member.tag, sanitizeName(member.name), member.role, highestRole,
                    playerData.townHallLevel, playerData.expLevel, playerData.trophies,
                    playerData.bestTrophies, playerData.warStars, playerData.donations,
                    playerData.donationsReceived, findAchievementValue(playerData.achievements, 'Friend in Need'),
                    findAchievementValue(playerData.achievements, 'Sharing is caring'), findAchievementValue(playerData.achievements, 'Siege Sharer')
                ];

                db.run(upsertSql, params);
            });
        }
        console.log('✅ Data update process finished successfully!');
    } catch (error) {
        console.error('❌ An error occurred during the update process:', error);
    }
});

// =================================================================
//  ENDPOINTS TO SERVE CACHED DATA
// =================================================================
// in server.js

app.get('/tracked-clan-data', (req, res) => {
    // The SQL query now sorts by trophies in descending order (this will be our default)
    const sql = "SELECT * FROM players ORDER BY trophies DESC";

    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read database.' });
        }

        const responseData = rows.map(player => ({
            tag: player.tag,
            name: player.name,
            trophies: player.trophies,
            currentRoleName: getRoleName(player.role),
            highestRoleName: getRoleName(player.highestRole),
            // ADDED: A numeric value for sorting by rank
            sortOrder: roleHierarchy[player.highestRole]
        }));

        res.json(responseData);
    });
});

app.get('/player/:playerTag', (req, res) => {
    const sql = "SELECT * FROM players WHERE tag = ?";
    const playerTagWithHash = '#' + req.params.playerTag;
    db.get(sql, [playerTagWithHash], (err, row) => {
        if (err) return res.status(500).json({ error: 'Failed to read database.' });
        if (!row) return res.status(404).json({ error: 'Player not found in database.' });
        res.json(row);
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
