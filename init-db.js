const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clan_data.db');

db.serialize(() => {
    const sql = `
    CREATE TABLE IF NOT EXISTS players (
      tag TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      highestRole TEXT,
      townHallLevel INTEGER,
      expLevel INTEGER,
      trophies INTEGER,
      bestTrophies INTEGER,
      warStars INTEGER,
      donations INTEGER,
      donationsReceived INTEGER,
      troopDonations INTEGER,
      spellDonations INTEGER,
      siegeDonations INTEGER
    )
  `;
    db.run(sql, (err) => {
        if (err) {
            return console.error(err.message);
        }
        console.log("✅ 'players' table created or already exists.");
    });
});

db.close();
