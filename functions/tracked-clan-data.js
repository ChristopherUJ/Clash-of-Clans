// functions/tracked-clan-data.js
const roleHierarchy = { 'member': 0, 'admin': 1, 'coLeader': 2, 'leader': 3 };
const getRoleName = (apiRole) => ({ member: 'Member', admin: 'Elder', coLeader: 'Co-Leader', leader: 'Leader' }[apiRole] || 'Unknown');

export async function onRequest(context) {
    try {
        const dbJson = await context.env.CLAN_DB.get("clan_data");
        if (!dbJson) {
            return new Response(JSON.stringify({ error: 'Database not found. Please run the /update-data endpoint first.' }), {
                status: 404, headers: { 'Content-Type': 'application/json' },
            });
        }
        const dbData = JSON.parse(dbJson);
        const responseData = Object.values(dbData).map(player => ({
            tag: player.tag,
            name: player.name,
            highestRoleName: getRoleName(player.highestRole),
            sortOrder: roleHierarchy[player.highestRole]
        })).sort((a, b) => b.sortOrder - a.sortOrder);
        return new Response(JSON.stringify(responseData), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to read from database.' }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
        });
    }
}
