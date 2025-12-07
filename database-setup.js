const SQLite = require("better-sqlite3");
const defaultMarketItems = require("./json/market-items.json");

// ( 🌟 التصحيح: الاستيراد من الملف الشامل الجديد 🌟 )
const fishingConfig = require("./json/fishing-config.json");
// استخراج القوائم المطلوبة من الملف الشامل
const fishItems = fishingConfig.fishItems; 
const baits = fishingConfig.baits;

function setupDatabase(sql) {
    // Activate WAL Mode for performance
    sql.pragma('journal_mode = WAL');
    sql.pragma('synchronous = 1');

    console.log("[Database] Checking integrity & schema...");

    // 1. All tables in one array
    const tables = [
        "CREATE TABLE IF NOT EXISTS levels (user TEXT NOT NULL, guild TEXT NOT NULL, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, totalXP INTEGER DEFAULT 0, mora INTEGER DEFAULT 0, lastWork INTEGER DEFAULT 0, lastDaily INTEGER DEFAULT 0, dailyStreak INTEGER DEFAULT 0, bank INTEGER DEFAULT 0, lastInterest INTEGER DEFAULT 0, totalInterestEarned INTEGER DEFAULT 0, hasGuard INTEGER DEFAULT 0, guardExpires INTEGER DEFAULT 0, totalVCTime INTEGER DEFAULT 0, lastCollected INTEGER DEFAULT 0, lastRob INTEGER DEFAULT 0, lastGuess INTEGER DEFAULT 0, lastRPS INTEGER DEFAULT 0, lastRoulette INTEGER DEFAULT 0, lastTransfer INTEGER DEFAULT 0, lastDeposit INTEGER DEFAULT 0, shop_purchases INTEGER DEFAULT 0, total_meow_count INTEGER DEFAULT 0, boost_count INTEGER DEFAULT 0, lastPVP INTEGER DEFAULT 0, lastFarmYield INTEGER DEFAULT 0, lastFish INTEGER DEFAULT 0, rodLevel INTEGER DEFAULT 1, boatLevel INTEGER DEFAULT 1, currentLocation TEXT DEFAULT 'beach', PRIMARY KEY (user, guild))",
        "CREATE TABLE IF NOT EXISTS settings (guild TEXT PRIMARY KEY, voiceXP INTEGER DEFAULT 0, voiceCooldown INTEGER DEFAULT 60000, customXP INTEGER DEFAULT 25, customCooldown INTEGER DEFAULT 60000, levelUpMessage TEXT, lvlUpTitle TEXT, lvlUpDesc TEXT, lvlUpImage TEXT, lvlUpColor TEXT, lvlUpMention INTEGER DEFAULT 1, streakEmoji TEXT DEFAULT '🔥', questChannelID TEXT, treeBotID TEXT, treeChannelID TEXT, treeMessageID TEXT, countingChannelID TEXT, vipRoleID TEXT, casinoChannelID TEXT, dropGiveawayChannelID TEXT, dropTitle TEXT, dropDescription TEXT, dropColor TEXT, dropFooter TEXT, dropButtonLabel TEXT, dropButtonEmoji TEXT, dropMessageContent TEXT, lastMediaUpdateSent TEXT, lastMediaUpdateMessageID TEXT, lastMediaUpdateChannelID TEXT, shopChannelID TEXT, bumpChannelID TEXT, customRoleAnchorID TEXT, customRolePanelTitle TEXT, customRolePanelDescription TEXT, customRolePanelImage TEXT, customRolePanelColor TEXT, lastQuestPanelChannelID TEXT, streakTimerChannelID TEXT, dailyTimerChannelID TEXT, weeklyTimerChannelID TEXT, img_level TEXT, img_mora TEXT, img_streak TEXT, img_media_streak TEXT, img_strongest TEXT, img_weekly_xp TEXT, img_daily_xp TEXT, img_achievements TEXT)",
        "CREATE TABLE IF NOT EXISTS report_settings (guildID TEXT PRIMARY KEY, logChannelID TEXT, reportChannelID TEXT, jailRoleID TEXT, arenaRoleID TEXT, unlimitedRoleID TEXT, testRoleID TEXT)",
        "CREATE TABLE IF NOT EXISTS report_permissions (guildID TEXT NOT NULL, roleID TEXT NOT NULL, PRIMARY KEY (guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS active_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, guildID TEXT NOT NULL, targetID TEXT NOT NULL, reporterID TEXT NOT NULL, timestamp INTEGER NOT NULL, UNIQUE(guildID, targetID, reporterID))",
        "CREATE TABLE IF NOT EXISTS jailed_members (guildID TEXT NOT NULL, userID TEXT NOT NULL, unjailTime INTEGER NOT NULL, PRIMARY KEY (guildID, userID))",
        "CREATE TABLE IF NOT EXISTS quest_achievement_roles (guildID TEXT NOT NULL, roleID TEXT NOT NULL, achievementID TEXT NOT NULL, PRIMARY KEY (guildID, roleID, achievementID))",
        "CREATE TABLE IF NOT EXISTS race_roles (guildID TEXT NOT NULL, roleID TEXT PRIMARY KEY, raceName TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS prefix (serverprefix TEXT, guild TEXT PRIMARY KEY)",
        "CREATE TABLE IF NOT EXISTS role_buffs (guildID TEXT NOT NULL, roleID TEXT NOT NULL, buffPercent INTEGER NOT NULL, PRIMARY KEY (guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS role_mora_buffs (guildID TEXT NOT NULL, roleID TEXT NOT NULL, buffPercent INTEGER NOT NULL, PRIMARY KEY (guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS user_buffs (id INTEGER PRIMARY KEY AUTOINCREMENT, guildID TEXT, userID TEXT, buffPercent INTEGER, expiresAt INTEGER, buffType TEXT, multiplier REAL DEFAULT 0.0)",
        "CREATE TABLE IF NOT EXISTS streaks (id TEXT PRIMARY KEY, guildID TEXT, userID TEXT, streakCount INTEGER, lastMessageTimestamp INTEGER, hasGracePeriod INTEGER, hasItemShield INTEGER, nicknameActive INTEGER DEFAULT 1, hasReceivedFreeShield INTEGER DEFAULT 0, separator TEXT DEFAULT '|', dmNotify INTEGER DEFAULT 1, highestStreak INTEGER DEFAULT 0, has12hWarning INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS rankCardTable (id TEXT PRIMARY KEY, barColor TEXT, textColor TEXT, backgroundColor TEXT)",
        "CREATE TABLE IF NOT EXISTS market_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, currentPrice INTEGER DEFAULT 0, lastChangePercent REAL DEFAULT 0.0, lastChange INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS user_portfolio (id INTEGER PRIMARY KEY AUTOINCREMENT, guildID TEXT NOT NULL, userID TEXT NOT NULL, itemID TEXT NOT NULL, quantity INTEGER DEFAULT 0, FOREIGN KEY (itemID) REFERENCES market_items(id), UNIQUE(guildID, userID, itemID))",
        "CREATE TABLE IF NOT EXISTS blacklistTable (id TEXT PRIMARY KEY, guild TEXT, typeId TEXT, type TEXT)",
        "CREATE TABLE IF NOT EXISTS channel (guild TEXT PRIMARY KEY, channel TEXT)",
        "CREATE TABLE IF NOT EXISTS user_farm (id INTEGER PRIMARY KEY AUTOINCREMENT, guildID TEXT NOT NULL, userID TEXT NOT NULL, animalID TEXT NOT NULL, purchaseTimestamp INTEGER DEFAULT 0, lastCollected INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS user_daily_stats (id TEXT PRIMARY KEY, userID TEXT NOT NULL, guildID TEXT NOT NULL, date TEXT NOT NULL, messages INTEGER DEFAULT 0, images INTEGER DEFAULT 0, stickers INTEGER DEFAULT 0, emojis_sent INTEGER DEFAULT 0, reactions_added INTEGER DEFAULT 0, replies_sent INTEGER DEFAULT 0, mentions_received INTEGER DEFAULT 0, vc_minutes INTEGER DEFAULT 0, water_tree INTEGER DEFAULT 0, counting_channel INTEGER DEFAULT 0, meow_count INTEGER DEFAULT 0, streaming_minutes INTEGER DEFAULT 0, disboard_bumps INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS user_achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, userID TEXT NOT NULL, guildID TEXT NOT NULL, achievementID TEXT NOT NULL, timestamp INTEGER NOT NULL, UNIQUE(userID, guildID, achievementID))",
        "CREATE TABLE IF NOT EXISTS user_quest_claims (claimID TEXT PRIMARY KEY, userID TEXT NOT NULL, guildID TEXT NOT NULL, questID TEXT NOT NULL, dateStr TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS user_weekly_stats (id TEXT PRIMARY KEY, userID TEXT NOT NULL, guildID TEXT NOT NULL, weekStartDate TEXT NOT NULL, messages INTEGER DEFAULT 0, images INTEGER DEFAULT 0, stickers INTEGER DEFAULT 0, emojis_sent INTEGER DEFAULT 0, reactions_added INTEGER DEFAULT 0, replies_sent INTEGER DEFAULT 0, mentions_received INTEGER DEFAULT 0, vc_minutes INTEGER DEFAULT 0, water_tree INTEGER DEFAULT 0, counting_channel INTEGER DEFAULT 0, meow_count INTEGER DEFAULT 0, streaming_minutes INTEGER DEFAULT 0, disboard_bumps INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS user_total_stats (id TEXT PRIMARY KEY, userID TEXT NOT NULL, guildID TEXT NOT NULL, total_messages INTEGER DEFAULT 0, total_images INTEGER DEFAULT 0, total_stickers INTEGER DEFAULT 0, total_emojis_sent INTEGER DEFAULT 0, total_reactions_added INTEGER DEFAULT 0, total_replies_sent INTEGER DEFAULT 0, total_mentions_received INTEGER DEFAULT 0, total_vc_minutes INTEGER DEFAULT 0, total_disboard_bumps INTEGER DEFAULT 0, UNIQUE(userID, guildID))",
        "CREATE TABLE IF NOT EXISTS quest_notifications (id TEXT PRIMARY KEY, userID TEXT NOT NULL, guildID TEXT NOT NULL, dailyNotif INTEGER DEFAULT 1, weeklyNotif INTEGER DEFAULT 1, achievementsNotif INTEGER DEFAULT 1, levelNotif INTEGER DEFAULT 1, UNIQUE(userID, guildID))",
        "CREATE TABLE IF NOT EXISTS user_weapons (id INTEGER PRIMARY KEY AUTOINCREMENT, userID TEXT NOT NULL, guildID TEXT NOT NULL, raceName TEXT NOT NULL, weaponLevel INTEGER DEFAULT 1, UNIQUE(userID, guildID, raceName))",
        "CREATE TABLE IF NOT EXISTS user_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, userID TEXT NOT NULL, guildID TEXT NOT NULL, skillID TEXT NOT NULL, skillLevel INTEGER DEFAULT 1, UNIQUE(userID, guildID, skillID))",
        "CREATE TABLE IF NOT EXISTS temporary_roles (userID TEXT NOT NULL, guildID TEXT NOT NULL, roleID TEXT NOT NULL, expiresAt INTEGER DEFAULT 0, PRIMARY KEY (userID, guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS command_shortcuts (guildID TEXT NOT NULL, channelID TEXT NOT NULL, shortcutWord TEXT NOT NULL, commandName TEXT NOT NULL, PRIMARY KEY (guildID, channelID, shortcutWord))",
        "CREATE TABLE IF NOT EXISTS command_permissions (guildID TEXT NOT NULL, channelID TEXT NOT NULL, commandName TEXT NOT NULL, PRIMARY KEY (guildID, channelID, commandName))",
        "CREATE TABLE IF NOT EXISTS user_loans (id INTEGER PRIMARY KEY AUTOINCREMENT, userID TEXT NOT NULL, guildID TEXT NOT NULL, loanAmount INTEGER DEFAULT 0, remainingAmount INTEGER DEFAULT 0, dailyPayment INTEGER DEFAULT 0, lastPaymentDate INTEGER DEFAULT 0, missedPayments INTEGER DEFAULT 0, UNIQUE(userID, guildID))",
        "CREATE TABLE IF NOT EXISTS giveaway_weights (guildID TEXT NOT NULL, roleID TEXT NOT NULL, weight INTEGER NOT NULL, PRIMARY KEY (guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS active_giveaways (messageID TEXT PRIMARY KEY, guildID TEXT NOT NULL, channelID TEXT NOT NULL, prize TEXT NOT NULL, endsAt INTEGER NOT NULL, winnerCount INTEGER NOT NULL, xpReward INTEGER DEFAULT 0, moraReward INTEGER DEFAULT 0, isFinished INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS giveaway_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, giveawayID TEXT NOT NULL, userID TEXT NOT NULL, weight INTEGER NOT NULL, UNIQUE(giveawayID, userID))",
        "CREATE TABLE IF NOT EXISTS media_streaks (id TEXT PRIMARY KEY, guildID TEXT, userID TEXT, streakCount INTEGER DEFAULT 0, lastMediaTimestamp INTEGER DEFAULT 0, hasGracePeriod INTEGER DEFAULT 1, hasItemShield INTEGER DEFAULT 0, hasReceivedFreeShield INTEGER DEFAULT 1, dmNotify INTEGER DEFAULT 1, highestStreak INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS media_streak_channels (guildID TEXT, channelID TEXT, lastReminderMessageID TEXT, PRIMARY KEY (guildID, channelID))",
        "CREATE TABLE IF NOT EXISTS level_roles (guildID TEXT NOT NULL, level INTEGER NOT NULL, roleID TEXT NOT NULL, PRIMARY KEY (guildID, level))",
        "CREATE TABLE IF NOT EXISTS custom_roles (id TEXT PRIMARY KEY, guildID TEXT NOT NULL, userID TEXT NOT NULL, roleID TEXT NOT NULL, UNIQUE(guildID, userID))",
        "CREATE TABLE IF NOT EXISTS custom_role_permissions (guildID TEXT NOT NULL, roleID TEXT NOT NULL, PRIMARY KEY (guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS role_menus_master (message_id TEXT PRIMARY KEY, custom_id TEXT UNIQUE NOT NULL, is_locked BOOLEAN NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS role_settings (role_id TEXT PRIMARY KEY, anti_roles TEXT, is_removable BOOLEAN NOT NULL DEFAULT 1)",
        "CREATE TABLE IF NOT EXISTS role_menu_items (message_id TEXT NOT NULL, value TEXT NOT NULL, role_id TEXT NOT NULL, description TEXT, emoji TEXT, PRIMARY KEY (message_id, value))",
        "CREATE TABLE IF NOT EXISTS rainbow_roles (roleID TEXT PRIMARY KEY, guildID TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS auto_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, guildID TEXT NOT NULL, trigger TEXT NOT NULL, response TEXT NOT NULL, images TEXT, matchType TEXT DEFAULT 'exact', cooldown INTEGER DEFAULT 0, allowedChannels TEXT, ignoredChannels TEXT, UNIQUE(guildID, trigger))",
        "CREATE TABLE IF NOT EXISTS world_boss (guildID TEXT PRIMARY KEY, currentHP INTEGER, maxHP INTEGER, name TEXT, image TEXT, active INTEGER DEFAULT 0, messageID TEXT, channelID TEXT, lastLog TEXT DEFAULT '[]', totalHits INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS boss_cooldowns (guildID TEXT, userID TEXT, lastHit INTEGER, PRIMARY KEY (guildID, userID))",
        "CREATE TABLE IF NOT EXISTS user_coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, guildID TEXT, userID TEXT, discountPercent INTEGER, isUsed INTEGER DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS boss_leaderboard (guildID TEXT, userID TEXT, totalDamage INTEGER DEFAULT 0, PRIMARY KEY(guildID, userID))",
        // 🔥🔥 الجداول الجديدة لنظام كوبونات الرتب 🔥🔥
        "CREATE TABLE IF NOT EXISTS role_coupons_config (guildID TEXT, roleID TEXT, discountPercent INTEGER, PRIMARY KEY (guildID, roleID))",
        "CREATE TABLE IF NOT EXISTS user_role_coupon_usage (guildID TEXT, userID TEXT, lastUsedTimestamp INTEGER, PRIMARY KEY (guildID, userID))"
    ];

    sql.transaction((tbls) => {
        tbls.forEach(t => sql.prepare(t).run());
    })(tables);

    sql.prepare("DROP TABLE IF EXISTS command_channels").run();

    // Migration logic
    function ensureColumn(table, column, typeDef) {
        try {
            const cols = sql.prepare(`PRAGMA table_info(${table})`).all();
            if (!cols.some(c => c.name === column)) {
                console.log(`[Migration] Adding '${column}' to '${table}'...`);
                sql.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`).run();
            }
        } catch (e) { }
    }

    // Perform Migrations
    ['mora', 'lastWork', 'lastDaily', 'dailyStreak', 'bank', 'lastInterest', 'totalInterestEarned', 'hasGuard', 'guardExpires', 'lastCollected', 'totalVCTime', 'lastRob', 'lastGuess', 'lastRPS', 'lastRoulette', 'lastTransfer', 'lastDeposit', 'shop_purchases', 'total_meow_count', 'boost_count', 'lastPVP', 'lastFarmYield', 'lastFish', 'rodLevel', 'boatLevel', 'lastMemory'].forEach(col => ensureColumn('levels', col, 'INTEGER DEFAULT 0'));
    ensureColumn('levels', 'currentLocation', "TEXT DEFAULT 'beach'");

    ['water_tree', 'counting_channel', 'meow_count', 'streaming_minutes', 'disboard_bumps', 'emojis_sent'].forEach(col => {
        ensureColumn('user_daily_stats', col, 'INTEGER DEFAULT 0');
        ensureColumn('user_weekly_stats', col, 'INTEGER DEFAULT 0');
    });
    ensureColumn('user_total_stats', 'total_vc_minutes', 'INTEGER DEFAULT 0');
    ensureColumn('user_total_stats', 'total_disboard_bumps', 'INTEGER DEFAULT 0');
    ensureColumn('user_total_stats', 'total_emojis_sent', 'INTEGER DEFAULT 0');

    ensureColumn('user_buffs', 'buffType', 'TEXT');
    ensureColumn('user_buffs', 'multiplier', 'REAL DEFAULT 0.0');
    ensureColumn('streaks', 'hasReceivedFreeShield', 'INTEGER DEFAULT 0');
    ensureColumn('streaks', 'separator', "TEXT DEFAULT '|'");
    ensureColumn('streaks', 'dmNotify', 'INTEGER DEFAULT 1');
    ensureColumn('streaks', 'highestStreak', 'INTEGER DEFAULT 0');
    ensureColumn('streaks', 'has12hWarning', 'INTEGER DEFAULT 0');
    
    const settingsCols = ["questChannelID", "treeBotID", "treeChannelID", "treeMessageID", "countingChannelID", "vipRoleID", "casinoChannelID", "dropGiveawayChannelID", "dropTitle", "dropDescription", "dropColor", "dropFooter", "dropButtonLabel", "dropButtonEmoji", "dropMessageContent", "lastMediaUpdateSent", "lastMediaUpdateMessageID", "lastMediaUpdateChannelID", "shopChannelID", "bumpChannelID", "customRoleAnchorID", "customRolePanelTitle", "customRolePanelDescription", "customRolePanelImage", "customRolePanelColor", "lastQuestPanelChannelID", "streakTimerChannelID", "dailyTimerChannelID", "weeklyTimerChannelID", "img_level", "img_mora", "img_streak", "img_media_streak", "img_strongest", "img_weekly_xp", "img_daily_xp", "img_achievements"];
    settingsCols.forEach(col => ensureColumn('settings', col, 'TEXT'));
    
    ensureColumn('quest_notifications', 'levelNotif', 'INTEGER DEFAULT 1');
    ensureColumn('active_giveaways', 'xpReward', 'INTEGER DEFAULT 0');
    ensureColumn('active_giveaways', 'moraReward', 'INTEGER DEFAULT 0');
    ensureColumn('active_giveaways', 'isFinished', 'INTEGER DEFAULT 0');
    ensureColumn('media_streak_channels', 'lastReminderMessageID', 'TEXT');

    // ( 🌟 Market Items Sync (Default + Fish + Baits) 🌟 )
    const itemsCount = sql.prepare("SELECT count(*) as count FROM market_items").get();
    const insertItem = sql.prepare("INSERT OR IGNORE INTO market_items (id, name, description, currentPrice) VALUES (@id, @name, @description, @price)");
    
    sql.transaction(() => {
        defaultMarketItems.forEach((item) => insertItem.run(item));
        
        if (fishItems && fishItems.length > 0) {
            fishItems.forEach((fish) => {
                insertItem.run({
                    id: fish.id,
                    name: fish.name,
                    description: `سمكة من نوع ${fish.name}`,
                    price: fish.price
                });
            });
        }

        if (baits && baits.length > 0) {
            baits.forEach((bait) => {
                insertItem.run({
                    id: bait.id,
                    name: bait.name,
                    description: bait.description,
                    price: bait.price
                });
            });
        }
    })();

    console.log("[Database] ✅ All tables checked, updated, and ready.");
}

module.exports = { setupDatabase };
