// functions/player/[tag].js
export async function onRequest(context) {
    try {
        const playerTagParam = '#' + context.params.tag;
        const dbJson = await context.env.CLAN_DB.get("clan_data");
        if (!dbJson) {
            return new Response(JSON.stringify({ error: 'Database is empty.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const dbData = JSON.parse(dbJson);
        const playerData = dbData[playerTagParam];
        if (!playerData) {
            return new Response(JSON.stringify({ error: 'Player not found in database.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(playerData), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to get player data.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
