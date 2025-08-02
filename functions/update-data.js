// functions/update-data.js

// --- HELPER FUNCTIONS ---
const roleHierarchy = { 'member': 0, 'admin': 1, 'coLeader': 2, 'leader': 3 };
const sanitizeName = (name) => (typeof name === 'string' ? name.replace(/[^a-zA-Z0-9\s.,!?'"#$%&()*+-_=<>@`~[\]{}:;\\|/]/g, '').trim() : '');
const findAchievementValue = (achievements, name) => {
    const achievement = achievements.find(ach => ach.name === name);
    return achievement ? achievement.value : 0;
};

export async function onRequest(context) {
    console.log('Starting data update process...');

    try {
        const { COC_API_KEY, COC_CLAN_TAG, CLAN_DB } = context.env;
        const COC_API_BASE_URL = 'https://api.clashofclans.com/v1';

        // A. Fetch the main clan member list
        const clanRes = await fetch(`${COC_API_BASE_URL}/clans/%23${COC_CLAN_TAG.replace('#', '')}`, {
            headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
        });
        const clanData = await clanRes.json();
        if (!clanData.memberList) throw new Error('Could not fetch clan member list.');

        // B. Read our existing database from KV
        const currentDbJson = await CLAN_DB.get("clan_data");
        let dbData = currentDbJson ? JSON.parse(currentDbJson) : {};

        // C. Fetch detailed stats for each player
        for (const member of clanData.memberList) {
            const playerRes = await fetch(`${COC_API_BASE_URL}/players/%23${member.tag.replace('#', '')}`, {
                headers: { 'Authorization': `Bearer ${COC_API_KEY}` }
            });
            const playerData = await playerRes.json();
            if (!playerRes.ok) continue;

            const storedPlayer = dbData[member.tag];
            let highestRole = member.role;
            if (storedPlayer && roleHierarchy[storedPlayer.highestRole] > roleHierarchy[member.role]) {
                highestRole = storedPlayer.highestRole;
            }

            // E. Store all relevant data
            dbData[member.tag] = {
                tag: member.tag, name: sanitizeName(member.name), role: member.role, highestRole: highestRole,
                townHallLevel: playerData.townHallLevel, expLevel: playerData.expLevel, trophies: playerData.trophies,
                bestTrophies: playerData.bestTrophies, warStars: playerData.warStars, donations: playerData.donations,
                donationsReceived: playerData.donationsReceived,
                troopDonations: findAchievementValue(playerData.achievements, 'Friend in Need'),
                spellDonations: findAchievementValue(playerData.achievements, 'Sharing is caring'),
                siegeDonations: findAchievementValue(playerData.achievements, 'Siege Sharer')
            };
        }

        // F. Write the enriched data back to KV
        await CLAN_DB.put("clan_data", JSON.stringify(dbData));

        const successMessage = '✅ Data update process finished successfully!';
        console.log(successMessage);
        return new Response(successMessage);

    } catch (error) {
        console.error('❌ An error occurred during the update process:', error);
        return new Response('Update failed. Check function logs.', { status: 500 });
    }
}
