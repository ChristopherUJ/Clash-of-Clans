// server.js
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// --- CONFIGURATION & SAFEGUARD ---
const COC_API_KEY = process.env.COC_API_KEY;
const COC_CLAN_TAG = process.env.COC_CLAN_TAG;
if (!COC_API_KEY || !COC_CLAN_TAG) {
    console.error("FATAL ERROR: Make sure COC_API_KEY and COC_CLAN_TAG are set correctly in your .env file.");
    process.exit(1);
}
const COC_API_BASE_URL = 'https://api.clashofclans.com/v1';
const DB_PATH = path.join(__dirname, 'db.json');

// --- HELPER FUNCTIONS ---
const roleHierarchy = { 'member': 0, 'admin': 1, 'coLeader': 2, 'leader': 3 };
const getRoleName = (apiRole) => ({ member: 'Member', admin: 'Elder', coLeader: 'Co-Leader', leader: 'Leader' }[apiRole] || 'Unknown');
const sanitizeName = (name) => (typeof name === 'string' ? name.replace(/[^a-zA-Z0-9\s.,!?'"#$%&()*+-_=<>@`~[\]{}:;\\|/]/g, '').trim() : '');
// NEW: Helper to find a specific achievement's value
const findAchievementValue = (achievements, name) => {
    const achievement = achievements.find(ach => ach.name === name);
    return achievement ? achievement.value : 0;
};

app.use(cors());
app.use(express.json());

// =================================================================
//  1. ENDPOINT TO UPDATE DATA (Manually triggered)
// =================================================================
app.get('/update-data', async (req, res) => {
    console.log('Starting data update process...');
    res.status(202).json({ message: 'Update process started. This may take a moment. Check server console for progress.' });

    try {
        const clanRes = await fetch(`${COC_API_BASE_URL}/clans/%23${COC_CLAN_TAG.replace('#', '')}`, {
            headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
        });
        const clanData = await clanRes.json();
        if (!clanData.memberList) throw new Error('Could not fetch clan member list.');

        let dbData = {};
        if (fs.existsSync(DB_PATH)) {
            dbData = JSON.parse(fs.readFileSync(DB_PATH));
        }

        for (const member of clanData.memberList) {
            console.log(`Fetching data for ${member.name} (${member.tag})...`);
            const playerRes = await fetch(`${COC_API_BASE_URL}/players/%23${member.tag.replace('#', '')}`, {
                headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
            });
            const playerData = await playerRes.json();
            if (!playerRes.ok) {
                console.warn(`Could not fetch data for ${member.tag}. Reason: ${playerData.reason}`);
                continue;
            }

            const storedPlayer = dbData[member.tag];
            let highestRole = member.role;
            if (storedPlayer && roleHierarchy[storedPlayer.highestRole] > roleHierarchy[member.role]) {
                highestRole = storedPlayer.highestRole;
            }

            // --- MODIFICATION: Get lifetime donation stats from achievements ---
            dbData[member.tag] = {
                tag: member.tag,
                name: sanitizeName(member.name),
                role: member.role,
                highestRole: highestRole,
                townHallLevel: playerData.townHallLevel,
                expLevel: playerData.expLevel,
                trophies: playerData.trophies,
                bestTrophies: playerData.bestTrophies,
                warStars: playerData.warStars,
                donations: playerData.donations, // Current season donations
                donationsReceived: playerData.donationsReceived, // Current season received
                // NEW: Lifetime donation stats
                troopDonations: findAchievementValue(playerData.achievements, 'Friend in Need'),
                spellDonations: findAchievementValue(playerData.achievements, 'Sharing is caring'),
                siegeDonations: findAchievementValue(playerData.achievements, 'Siege Sharer')
            };
        }

        fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
        console.log('✅ Data update process finished successfully!');
    } catch (error) {
        console.error('❌ An error occurred during the update process:', error);
    }
});

// =================================================================
//  2. ENDPOINTS TO SERVE CACHED DATA (Instantly loads)
// =================================================================
// Endpoint for the main clan list page (index.html)
app.get('/tracked-clan-data', (req, res) => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return res.status(404).json({ error: 'Database not found. Please run the /update-data endpoint first.' });
        }
        const dbData = JSON.parse(fs.readFileSync(DB_PATH));
        const responseData = Object.values(dbData).map(player => ({
            tag: player.tag,
            name: player.name,
            highestRoleName: getRoleName(player.highestRole),
            sortOrder: roleHierarchy[player.highestRole]
        })).sort((a, b) => b.sortOrder - a.sortOrder);
        res.json(responseData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read database.' });
    }
});

// Endpoint for the single player stats page (player.html)
app.get('/player/:playerTag', (req, res) => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return res.status(404).json({ error: 'Database not found. Please run the /update-data endpoint first.' });
        }
        const dbData = JSON.parse(fs.readFileSync(DB_PATH));
        const playerTagWithHash = '#' + req.params.playerTag;
        const playerData = dbData[playerTagWithHash];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found in the database.' });
        }
        res.json(playerData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read database.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    console.log('Visit http://localhost:3000/update-data to refresh the clan data.');
});
