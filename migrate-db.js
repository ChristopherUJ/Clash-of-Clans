const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clan_data.db');

console.log("Running migration...");

db.serialize(() => {
    // We first check if the column already exists to prevent errors on re-running
    db.all("PRAGMA table_info(players)", (err, columns) => {
        if (err) {
            return console.error("Error fetching table info:", err.message);
        }

        const columnExists = columns.some(col => col.name === 'lastSeenActive');

        if (!columnExists) {
            console.log("Adding 'lastSeenActive' column to 'players' table...");
            db.run("ALTER TABLE players ADD COLUMN lastSeenActive TEXT", (alterErr) => {
                if (alterErr) {
                    return console.error("Error adding column:", alterErr.message);
                }
                console.log("✅ Column 'lastSeenActive' added successfully.");
            });
        } else {
            console.log("✅ Column 'lastSeenActive' already exists.");
        }

        // Close the database connection when all operations are done
        db.close((closeErr) => {
            if (closeErr) {
                return console.error(closeErr.message);
            }
            console.log('Migration script finished. Closed the database connection.');
        });
    });
});
