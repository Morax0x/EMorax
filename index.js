// ( 🌟 Added REST and Routes imports 🌟 )
const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionsBitField, Events, Colors, MessageFlags, ChannelType, REST, Routes, Partials } = require("discord.js");
const SQLite = require("better-sqlite3");
const fs = require('fs');
const path = require('path');

// ==================================================================
// 1. Database Setup
// ==================================================================
const sql = new SQLite('./mainDB.sqlite');
sql.pragma('journal_mode = WAL');

try {
    const { setupDatabase } = require("./database-setup.js");
    setupDatabase(sql);
} catch (err) {
    console.error("!!! Database Setup Fatal Error !!!");
    console.error(err);
    process.exit(1);
}

// Ensure critical columns exist (Migration)
// (نستخدم try-catch صامت لتجنب الإزعاج عند الإغلاق)
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN casinoChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN chatChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN treeBotID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN treeChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN countingChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN questChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE levels ADD COLUMN lastFarmYield INTEGER DEFAULT 0").run(); } catch (e) {} 
try { if(sql.open) sql.prepare("CREATE TABLE IF NOT EXISTS quest_achievement_roles (guildID TEXT, roleID TEXT, achievementID TEXT)").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN shopChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN bumpChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN customRoleAnchorID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN customRolePanelTitle TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN customRolePanelDescription TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN customRolePanelImage TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN customRolePanelColor TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN lastQuestPanelChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN streakTimerChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN dailyTimerChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("ALTER TABLE settings ADD COLUMN weeklyTimerChannelID TEXT").run(); } catch (e) {}
try { if(sql.open) sql.prepare("CREATE TABLE IF NOT EXISTS rainbow_roles (roleID TEXT PRIMARY KEY, guildID TEXT NOT NULL)").run(); } catch (e) {}

// ==================================================================
// 2. Import Handlers and Files
// ==================================================================
const { handleStreakMessage, calculateBuffMultiplier, checkDailyStreaks, updateNickname, calculateMoraBuff, checkDailyMediaStreaks, sendMediaStreakReminders, sendDailyMediaUpdate, sendStreakWarnings } = require("./streak-handler.js");
const { checkPermissions, checkCooldown } = require("./permission-handler.js");

const questsConfig = require('./json/quests-config.json');
const farmAnimals = require('./json/farm-animals.json');

const { generateSingleAchievementAlert, generateQuestAlert } = require('./generators/achievement-generator.js'); 
const { createRandomDropGiveaway, endGiveaway, getUserWeight } = require('./handlers/giveaway-handler.js');
const { checkUnjailTask } = require('./handlers/report-handler.js'); 
const { loadRoleSettings } = require('./handlers/reaction-role-handler.js');

// ==================================================================
// 3. Client Setup
// ==================================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction] 
});

client.commands = new Collection();
client.cooldowns = new Collection();
client.talkedRecently = new Map();
const voiceXPCooldowns = new Map();
client.recentMessageTimestamps = new Collection(); 
const RECENT_MESSAGE_WINDOW = 2 * 60 * 60 * 1000; 
const botToken = process.env.DISCORD_BOT_TOKEN;

client.EMOJI_MORA = '<:mora:1435647151349698621>';
client.EMOJI_STAR = '⭐';
client.EMOJI_WI = '<a:wi:1435572304988868769>';
client.EMOJI_WII = '<a:wii:1435572329039007889>';
client.EMOJI_FASTER = '<a:JaFaster:1435572430042042409>';
client.EMOJI_PRAY = '<:0Pray:1437067281493524502>';
client.EMOJI_COOL = '<a:NekoCool:1435572459276337245>';
const EMOJI_XP_ANIM = '<a:levelup:1437805366048985290>';

client.sql = sql;
client.generateSingleAchievementAlert = generateSingleAchievementAlert;
client.generateQuestAlert = generateQuestAlert;

// Prepared Statements
if (sql.open) {
    client.getLevel = sql.prepare("SELECT * FROM levels WHERE user = ? AND guild = ?");
    client.setLevel = sql.prepare("INSERT OR REPLACE INTO levels (user, guild, xp, level, totalXP, mora, lastWork, lastDaily, dailyStreak, bank, lastInterest, totalInterestEarned, hasGuard, guardExpires, lastCollected, totalVCTime, lastRob, lastGuess, lastRPS, lastRoulette, lastTransfer, lastDeposit, shop_purchases, total_meow_count, boost_count, lastPVP, lastFarmYield) VALUES (@user, @guild, @xp, @level, @totalXP, @mora, @lastWork, @lastDaily, @dailyStreak, @bank, @lastInterest, @totalInterestEarned, @hasGuard, @guardExpires, @lastCollected, @totalVCTime, @lastRob, @lastGuess, @lastRPS, @lastRoulette, @lastTransfer, @lastDeposit, @shop_purchases, @total_meow_count, @boost_count, @lastPVP, @lastFarmYield);");
    client.defaultData = { user: null, guild: null, xp: 0, level: 1, totalXP: 0, mora: 0, lastWork: 0, lastDaily: 0, dailyStreak: 0, bank: 0, lastInterest: 0, totalInterestEarned: 0, hasGuard: 0, guardExpires: 0, lastCollected: 0, totalVCTime: 0, lastRob: 0, lastGuess: 0, lastRPS: 0, lastRoulette: 0, lastTransfer: 0, lastDeposit: 0, shop_purchases: 0, total_meow_count: 0, boost_count: 0, lastPVP: 0, lastFarmYield: 0 };

    client.getDailyStats = sql.prepare("SELECT * FROM user_daily_stats WHERE id = ?");
    client.setDailyStats = sql.prepare("INSERT OR REPLACE INTO user_daily_stats (id, userID, guildID, date, messages, images, stickers, reactions_added, replies_sent, mentions_received, vc_minutes, water_tree, counting_channel, meow_count, streaming_minutes, disboard_bumps) VALUES (@id, @userID, @guildID, @date, @messages, @images, @stickers, @reactions_added, @replies_sent, @mentions_received, @vc_minutes, @water_tree, @counting_channel, @meow_count, @streaming_minutes, @disboard_bumps);");
    client.getWeeklyStats = sql.prepare("SELECT * FROM user_weekly_stats WHERE id = ?");
    client.setWeeklyStats = sql.prepare("INSERT OR REPLACE INTO user_weekly_stats (id, userID, guildID, weekStartDate, messages, images, stickers, reactions_added, replies_sent, mentions_received, vc_minutes, water_tree, counting_channel, meow_count, streaming_minutes, disboard_bumps) VALUES (@id, @userID, @guildID, @weekStartDate, @messages, @images, @stickers, @reactions_added, @replies_sent, @mentions_received, @vc_minutes, @water_tree, @counting_channel, @meow_count, @streaming_minutes, @disboard_bumps);");
    client.getTotalStats = sql.prepare("SELECT * FROM user_total_stats WHERE id = ?");
    client.setTotalStats = sql.prepare("INSERT OR REPLACE INTO user_total_stats (id, userID, guildID, total_messages, total_images, total_stickers, total_reactions_added, total_replies_sent, total_mentions_received, total_vc_minutes, total_disboard_bumps) VALUES (@id, @userID, @guildID, @total_messages, @total_images, @total_stickers, @total_reactions_added, @total_replies_sent, @total_mentions_received, @total_vc_minutes, @total_disboard_bumps);");
    client.getQuestNotif = sql.prepare("SELECT * FROM quest_notifications WHERE id = ?");
    client.setQuestNotif = sql.prepare("INSERT OR REPLACE INTO quest_notifications (id, userID, guildID, dailyNotif, weeklyNotif, achievementsNotif, levelNotif) VALUES (@id, @userID, @guildID, @dailyNotif, @weeklyNotif, @achievementsNotif, @levelNotif);");
}

// (Optional) Backup scheduler
try { require('./handlers/backup-scheduler.js')(client, sql); } catch(e) {}

const defaultDailyStats = { messages: 0, images: 0, stickers: 0, reactions_added: 0, replies_sent: 0, mentions_received: 0, vc_minutes: 0, water_tree: 0, counting_channel: 0, meow_count: 0, streaming_minutes: 0, disboard_bumps: 0 };
const defaultTotalStats = { total_messages: 0, total_images: 0, total_stickers: 0, total_reactions_added: 0, total_replies_sent: 0, total_mentions_received: 0, total_vc_minutes: 0, total_disboard_bumps: 0 };

client.safeMerge = function(base, defaults) {
    const result = { ...base };
    for (const key in defaults) {
        if (result[key] === undefined) result[key] = defaults[key];
    }
    return result;
};

function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function getWeekStartDateString() {
    const now = new Date();
    const diff = now.getUTCDate() - (now.getUTCDay() + 2) % 7; 
    const friday = new Date(now.setUTCDate(diff));
    friday.setUTCHours(0, 0, 0, 0); 
    return friday.toISOString().split('T')[0];
}

// ==================================================================
// 4. Helper Functions
// ==================================================================

client.checkAndAwardLevelRoles = async function(member, newLevel) {
    if (!client.sql.open) return;
    try {
        const guild = member.guild;
        const allLevelRoles = sql.prepare("SELECT level, roleID FROM level_roles WHERE guildID = ? ORDER BY level DESC").all(guild.id);
        if (allLevelRoles.length === 0) return; 
        const botMember = guild.members.me;
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
        let roleToAdd = null; 
        const rolesToRemove = []; 
        let highestRoleFound = false; 
        for (const row of allLevelRoles) {
            const role = guild.roles.cache.get(row.roleID);
            if (!role) continue;
            if (row.level <= newLevel && !highestRoleFound) {
                highestRoleFound = true;
                if (!member.roles.cache.has(role.id)) roleToAdd = role; 
            } else {
                if (member.roles.cache.has(role.id)) rolesToRemove.push(role);
            }
        }
        if (roleToAdd && roleToAdd.position < botMember.roles.highest.position) {
            await member.roles.add(roleToAdd);
        }
        if (rolesToRemove.length > 0) {
            try { await member.roles.remove(rolesToRemove); } catch (e) {}
        }
    } catch (err) { console.error("[Level Roles] Error:", err.message); }
}

client.sendLevelUpMessage = async function(messageOrInteraction, member, newLevel, oldLevel, xpData) {
    if (!client.sql.open) return;
    try {
        await client.checkAndAwardLevelRoles(member, newLevel);
        const guild = member.guild;
        let channelToSend = null;

        try {
            let channelData = sql.prepare("SELECT channel FROM channel WHERE guild = ?").get(guild.id);
            if (channelData && channelData.channel && channelData.channel !== 'Default') {
                const fetchedChannel = guild.channels.cache.get(channelData.channel);
                if (fetchedChannel) channelToSend = fetchedChannel;
            }
        } catch(e) {}

        if (!channelToSend) {
            if (messageOrInteraction && messageOrInteraction.channel) {
                channelToSend = messageOrInteraction.channel;
            } else {
                return; 
            }
        }

        let customSettings = sql.prepare("SELECT * FROM settings WHERE guild = ?").get(guild.id);
        let levelUpContent = null;
        let embed;
        if (customSettings && customSettings.lvlUpTitle) {
            function antonymsLevelUp(string) {
                return string.replace(/{member}/gi, `${member}`).replace(/{level}/gi, `${newLevel}`).replace(/{level_old}/gi, `${oldLevel}`).replace(/{xp}/gi, `${xpData.xp}`).replace(/{totalXP}/gi, `${xpData.totalXP}`);
            }
            embed = new EmbedBuilder().setTitle(antonymsLevelUp(customSettings.lvlUpTitle)).setDescription(antonymsLevelUp(customSettings.lvlUpDesc.replace(/\\n/g, '\n'))).setColor(customSettings.lvlUpColor || "Random").setTimestamp();
            if (customSettings.lvlUpImage) { embed.setImage(antonymsLevelUp(customSettings.lvlUpImage)); }
            if (customSettings.lvlUpMention == 1) { levelUpContent = `${member}`; }
        } else {
            embed = new EmbedBuilder().setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) }).setColor("Random").setDescription(`**Congratulations** ${member}! You have now leveled up to **level ${newLevel}**`);
        }
        
        const perms = channelToSend.permissionsFor(guild.members.me);
        if (perms.has(PermissionsBitField.Flags.SendMessages) && perms.has(PermissionsBitField.Flags.ViewChannel)) {
            await channelToSend.send({ content: levelUpContent, embeds: [embed] }).catch(() => {});
        }
    } catch (err) { console.error(`[LevelUp Error]: ${err.message}`); }
}

client.sendQuestAnnouncement = async function(guild, member, quest, questType = 'achievement') {
    if (!client.sql.open) return;
    try {
        const id = `${member.id}-${guild.id}`;
        let notifSettings = sql.prepare("SELECT * FROM quest_notifications WHERE id = ?").get(id);

        if (!notifSettings) {
            notifSettings = { id: id, userID: member.id, guildID: guild.id, dailyNotif: 1, weeklyNotif: 1, achievementsNotif: 1, levelNotif: 1 };
            client.setQuestNotif.run(notifSettings);
        }

        let sendMention = false;
        if (questType === 'daily' && notifSettings.dailyNotif === 1) sendMention = true;
        if (questType === 'weekly' && notifSettings.weeklyNotif === 1) sendMention = true;
        if (questType === 'achievement' && notifSettings.achievementsNotif === 1) sendMention = true;

        const userIdentifier = sendMention ? `${member}` : `**${member.displayName}**`;
          
        const settings = sql.prepare("SELECT questChannelID, lastQuestPanelChannelID FROM settings WHERE guild = ?").get(guild.id);
        if (!settings || !settings.questChannelID) return; 

        const channel = guild.channels.cache.get(settings.questChannelID);
        if (!channel) return;
        const perms = channel.permissionsFor(guild.members.me);
        if (!perms || !perms.has(PermissionsBitField.Flags.SendMessages)) return;

        const canAttachFiles = perms.has(PermissionsBitField.Flags.AttachFiles);
        const questName = quest.name;
        const reward = quest.reward; 
        let message = '';
        let files = []; 
          
        const rewardDetails = `\n- **حصـلـت عـلـى:**\nMora: \`${reward.mora.toLocaleString()}\` ${client.EMOJI_MORA} | XP: \`${reward.xp.toLocaleString()}\` ${EMOJI_XP_ANIM}`;

        const panelChannelLink = settings.lastQuestPanelChannelID ? `\n\n✶ قـاعـة الانجـازات والمـهام والاشعـارات:\n<#${settings.lastQuestPanelChannelID}>` : "";

        if (canAttachFiles) {
            try {
                let attachment;
                if (questType === 'achievement') {
                    attachment = await client.generateSingleAchievementAlert(member, quest);
                } else {
                    const typeForAlert = questType === 'weekly' ? 'rare' : 'daily';
                    attachment = await client.generateQuestAlert(member, quest, typeForAlert);
                }
                if(attachment) files.push(attachment);
            } catch (imgErr) { console.error("[Image Gen Fail]", imgErr); }
        }

        if (questType === 'achievement') {
            message = [
                `╭⭒★︰ ${client.EMOJI_WI} ${userIdentifier} ${client.EMOJI_WII}`,
                `✶ انـرت سمـاء الامـبراطـوريـة بإنجـازك ${client.EMOJI_FASTER}`,
                `✥ انـجـاز: **${questName}**`,
                ``,
                `- فـالتسـجل امبراطوريتـنـا اسمـك بيـن العضـمـاء ${client.EMOJI_PRAY}`,
                rewardDetails,
                panelChannelLink 
            ].join('\n');
        } else {
            const typeText = questType === 'daily' ? 'يوميـة' : 'اسبوعيـة';
            message = [
                `╭⭒★︰ ${client.EMOJI_WI} ${userIdentifier} ${client.EMOJI_WII}`,
                `✶ اتـممـت مهمـة ${typeText}`,
                `✥ الـمهـمـة: **${questName}**`,
                ``,
                `- لقـد أثبـت انـك احـد اركـان الامبراطـورية ${client.EMOJI_PRAY}`,
                `- لا يُكلـف مثـلك الا بالمستحيـل ${client.EMOJI_COOL} ~`,
                rewardDetails,
                panelChannelLink 
            ].join('\n');
        }
          
        await channel.send({ content: message, files: files, allowedMentions: { users: sendMention ? [member.id] : [] } });

    } catch (err) { console.error("Error sending quest announcement:", err.message); }
}

client.checkQuests = async function(client, member, stats, questType, dateKey) {
    if (!client.sql.open) return;
    const questsToCheck = questsConfig[questType] || [];
    for (const quest of questsToCheck) {
        const currentProgress = stats[quest.stat] || 0;
        if (currentProgress >= quest.goal) {
            const claimID = `${member.id}-${member.guild.id}-${quest.id}-${dateKey}`;
            const existingClaim = sql.prepare("SELECT * FROM user_quest_claims WHERE claimID = ?").get(claimID);
            if (!existingClaim) {
                sql.prepare("INSERT INTO user_quest_claims (claimID, userID, guildID, questID, dateStr) VALUES (?, ?, ?, ?, ?)").run(claimID, member.id, member.guild.id, quest.id, dateKey);
                let levelData = client.getLevel.get(member.id, member.guild.id);
                if (!levelData) levelData = { ...client.defaultData, user: member.id, guild: member.guild.id };
                levelData.mora = (levelData.mora || 0) + quest.reward.mora;
                levelData.xp += quest.reward.xp;
                levelData.totalXP += quest.reward.xp;
                const nextXP = 5 * (levelData.level ** 2) + (50 * levelData.level) + 100;
                if (levelData.xp >= nextXP) {
                    const oldLevel = levelData.level;
                    levelData.xp -= nextXP;
                    levelData.level += 1;
                }
                client.setLevel.run(levelData);
                await client.sendQuestAnnouncement(member.guild, member, quest, questType);
            }
        }
    }
}

client.checkAchievements = async function(client, member, levelData, totalStatsData) {
    if (!client.sql.open) return;
    for (const ach of questsConfig.achievements) {
        let currentProgress = 0;
        const streakData = sql.prepare("SELECT * FROM streaks WHERE guildID = ? AND userID = ?").get(member.id, member.guild.id);
        const mediaStreakData = sql.prepare("SELECT * FROM media_streaks WHERE guildID = ? AND userID = ?").get(member.guild.id, member.id);
          
        if (!totalStatsData) totalStatsData = client.getTotalStats.get(`${member.id}-${member.guild.id}`) || {};
        totalStatsData = client.safeMerge(totalStatsData, defaultTotalStats); 

        if (ach.stat === 'messages') currentProgress = totalStatsData.total_messages || 0;
        else if (ach.stat === 'total_messages') currentProgress = totalStatsData.total_messages || 0; 
        else if (ach.stat === 'images') currentProgress = totalStatsData.total_images || 0;
        else if (ach.stat === 'stickers') currentProgress = totalStatsData.total_stickers || 0;
        else if (ach.stat === 'reactions_added') currentProgress = totalStatsData.total_reactions_added || 0;
        else if (ach.stat === 'total_reactions_added') currentProgress = totalStatsData.total_reactions_added || 0;
        else if (ach.stat === 'replies_sent') currentProgress = totalStatsData.total_replies_sent || 0;
        else if (ach.stat === 'vc_minutes') currentProgress = totalStatsData.total_vc_minutes || 0;
        else if (ach.stat === 'totalVCTime') currentProgress = totalStatsData.total_vc_minutes || 0;
        else if (ach.stat === 'disboard_bumps') currentProgress = totalStatsData.total_disboard_bumps || 0;
        else if (ach.stat === 'meow_count' || ach.stat === 'total_meow_count') {
             let ld = levelData || client.getLevel.get(member.id, member.guild.id);
             currentProgress = ld ? (ld.total_meow_count || 0) : 0;
        }
        else if (ach.stat === 'boost_count') {
             let ld = levelData || client.getLevel.get(member.id, member.guild.id);
             currentProgress = ld ? (ld.boost_count || 0) : 0;
        }
        else if (levelData && levelData.hasOwnProperty(ach.stat)) currentProgress = levelData[ach.stat];
        else if (totalStatsData.hasOwnProperty(ach.stat)) currentProgress = totalStatsData[ach.stat];
        else if (ach.stat === 'highestStreak' && streakData) currentProgress = streakData.highestStreak || 0;
        else if (ach.stat === 'highestMediaStreak' && mediaStreakData) currentProgress = mediaStreakData.highestStreak || 0;
        else if (streakData && streakData.hasOwnProperty(ach.stat)) currentProgress = streakData[ach.stat];
        else {
             if (['has_caesar_role', 'has_race_role', 'has_tree_role', 'has_tag_role'].includes(ach.stat)) continue;
            continue;
        }

        if (currentProgress >= ach.goal) {
            const existingAch = sql.prepare("SELECT * FROM user_achievements WHERE userID = ? AND guildID = ? AND achievementID = ?").get(member.id, member.guild.id, ach.id);
            if (!existingAch) {
                sql.prepare("INSERT INTO user_achievements (userID, guildID, achievementID, timestamp) VALUES (?, ?, ?, ?)").run(member.id, member.guild.id, ach.id, Date.now());
                let ld = levelData || client.getLevel.get(member.id, member.guild.id);
                if (!ld) ld = { ...client.defaultData, user: member.id, guild: member.guild.id };
                ld.mora = (ld.mora || 0) + ach.reward.mora;
                ld.xp += ach.reward.xp;
                ld.totalXP += ach.reward.xp;
                const nextXP = 5 * (ld.level ** 2) + (50 * ld.level) + 100;
                if (ld.xp >= nextXP) {
                    ld.xp -= nextXP;
                    ld.level += 1;
                }
                client.setLevel.run(ld);
                await client.sendQuestAnnouncement(member.guild, member, ach, 'achievement');
            }
        }
    }
}

// Increment Stats ( 🌟 Safety Fix Here 🌟 )
client.incrementQuestStats = async function(userID, guildID, stat, amount = 1) {
    // Safety Check
    if (!client.sql.open) return;

    if (stat === 'messages') {
        if (!client.recentMessageTimestamps.has(guildID)) client.recentMessageTimestamps.set(guildID, []);
        const guildTimestamps = client.recentMessageTimestamps.get(guildID);
        const now = Date.now();
        for (let i = 0; i < amount; i++) { guildTimestamps.push(now); }
        while (guildTimestamps.length > 0 && guildTimestamps[0] < (now - RECENT_MESSAGE_WINDOW)) { guildTimestamps.shift(); }
    }
    try {
        const dateStr = getTodayDateString();
        const weekStartDateStr = getWeekStartDateString();
        const dailyStatsId = `${userID}-${guildID}-${dateStr}`;
        const weeklyStatsId = `${userID}-${guildID}-${weekStartDateStr}`;
        const totalStatsId = `${userID}-${guildID}`;

        let dailyStats = client.getDailyStats.get(dailyStatsId) || { id: dailyStatsId, userID, guildID, date: dateStr };
        let weeklyStats = client.getWeeklyStats.get(weeklyStatsId) || { id: weeklyStatsId, userID, guildID, weekStartDate: weekStartDateStr };
        let totalStats = client.getTotalStats.get(totalStatsId) || { id: totalStatsId, userID, guildID };

        dailyStats = client.safeMerge(dailyStats, defaultDailyStats);
        weeklyStats = client.safeMerge(weeklyStats, defaultDailyStats);
        totalStats = client.safeMerge(totalStats, defaultTotalStats);

        if (dailyStats.hasOwnProperty(stat)) dailyStats[stat] = (dailyStats[stat] || 0) + amount;
        if (weeklyStats.hasOwnProperty(stat)) weeklyStats[stat] = (weeklyStats[stat] || 0) + amount;
        
        if (stat === 'disboard_bumps') totalStats.total_disboard_bumps = (totalStats.total_disboard_bumps || 0) + amount;
        if (stat === 'messages') totalStats.total_messages = (totalStats.total_messages || 0) + amount;
        if (stat === 'images') totalStats.total_images = (totalStats.total_images || 0) + amount;
        if (stat === 'replies_sent') totalStats.total_replies_sent = (totalStats.total_replies_sent || 0) + amount;
        if (stat === 'mentions_received') totalStats.total_mentions_received = (totalStats.total_mentions_received || 0) + amount;
        if (stat === 'vc_minutes') totalStats.total_vc_minutes = (totalStats.total_vc_minutes || 0) + amount;
          
        client.setDailyStats.run(dailyStats);
        client.setWeeklyStats.run(weeklyStats);
        
        client.setTotalStats.run({
            id: totalStatsId, 
            userID, 
            guildID,
            total_messages: totalStats.total_messages, 
            total_images: totalStats.total_images, 
            total_stickers: totalStats.total_stickers,
            total_reactions_added: totalStats.total_reactions_added, 
            total_replies_sent: totalStats.total_replies_sent, 
            total_mentions_received: totalStats.total_mentions_received, 
            total_vc_minutes: totalStats.total_vc_minutes, 
            total_disboard_bumps: totalStats.total_disboard_bumps
        });

        const member = client.guilds.cache.get(guildID)?.members.cache.get(userID);
        if (member) {
            await client.checkQuests(client, member, dailyStats, 'daily', dateStr);
            await client.checkQuests(client, member, weeklyStats, 'weekly', weekStartDateStr);
            await client.checkAchievements(client, member, null, totalStats);
            
             if (stat === 'meow_count') {
                 let levelData = client.getLevel.get(userID, guildID);
                 if (levelData) await client.checkAchievements(client, member, levelData, totalStats);
            }
            if (stat === 'water_tree') {
                 let levelData = client.getLevel.get(userID, guildID);
                 if (levelData) await client.checkAchievements(client, member, levelData, totalStats);
            }
        }
    } catch (err) { 
        // Silent catch during database locks
        if (!err.message.includes("database connection is not open")) {
            console.error(`[IncrementQuestStats] Error:`, err.message);
        }
    }
}

client.checkRoleAchievement = async function(member, roleId, achievementId) {
    if (!client.sql.open) return;
    try {
        const guildID = member.guild.id;
        const userID = member.id;
        const existingAch = sql.prepare("SELECT * FROM user_achievements WHERE userID = ? AND guildID = ? AND achievementID = ?").get(userID, guildID, achievementId);
        const ach = questsConfig.achievements.find(a => a.id === achievementId);
        if (!ach) return;
        let hasRole = false;
        if (achievementId === 'ach_race_role') {
            const raceRoles = sql.prepare("SELECT roleID FROM race_roles WHERE guildID = ?").all(guildID);
            const raceRoleIDs = raceRoles.map(r => r.roleID);
            hasRole = member.roles.cache.some(role => raceRoleIDs.includes(role.id));
        } else { hasRole = member.roles.cache.has(roleId); }
        if (hasRole) {
            if (existingAch) return; 
            sql.prepare("INSERT INTO user_achievements (userID, guildID, achievementID, timestamp) VALUES (?, ?, ?, ?)").run(userID, guildID, ach.id, Date.now());
            let ld = client.getLevel.get(userID, guildID);
            if (!ld) ld = { ...client.defaultData, user: userID, guild: guildID };
            ld.mora = (ld.mora || 0) + ach.reward.mora;
            ld.xp += ach.reward.xp;
            ld.totalXP += ach.reward.xp;
            client.setLevel.run(ld);
            await client.sendQuestAnnouncement(member.guild, member, ach, 'achievement');
        } else {
            if (existingAch) {
                sql.prepare("DELETE FROM user_achievements WHERE userID = ? AND guildID = ? AND achievementID = ?").run(userID, guildID, achievementId);
            }
        }
    } catch (err) { console.error(`[checkRoleAchievement] Error:`, err.message); }
}

// ==================================================================
// 5. Economy, Farm, and Loans
// ==================================================================

function updateMarketPrices() {
    if (!sql.open) return;
    try {
        const allItems = sql.prepare("SELECT * FROM market_items").all();
        if (allItems.length === 0) return;
        const updateStmt = sql.prepare(`UPDATE market_items SET currentPrice = ?, lastChangePercent = ?, lastChange = ? WHERE id = ?`);
        const transaction = sql.transaction(() => {
            for (const item of allItems) {
                const oldPrice = item.currentPrice;
                let changePercent = (Math.random() * 0.30) - 0.15; 
                if (oldPrice > 1000 && changePercent > 0) changePercent /= 5; 
                let newPrice = Math.floor(oldPrice * (1 + changePercent));
                if (newPrice > 10000) newPrice = 10000; 
                if (newPrice < 50) newPrice = 50;        
                const changeAmount = newPrice - oldPrice;
                const finalPercent = ((changeAmount / oldPrice) * 100).toFixed(2);
                updateStmt.run(newPrice, finalPercent, changeAmount, item.id);
            }
        });
        transaction();
        console.log(`[Market] Prices updated.`);
    } catch (err) { console.error("[Market] Error updating prices:", err.message); }
}

const checkLoanPayments = async () => {
    if (!sql.open) return;
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const activeLoans = sql.prepare("SELECT * FROM user_loans WHERE remainingAmount > 0 AND (lastPaymentDate + ?) <= ?").all(ONE_DAY, now);
    if (activeLoans.length === 0) return;
    for (const loan of activeLoans) {
        try {
            const guild = client.guilds.cache.get(loan.guildID);
            if (!guild) continue;
            let userData = client.getLevel.get(loan.userID, loan.guildID);
            if (!userData) continue;
            const paymentAmount = Math.min(loan.dailyPayment, loan.remainingAmount);
            let remainingToPay = paymentAmount;
            
            if (userData.mora > 0) {
                const takeMora = Math.min(userData.mora, remainingToPay);
                userData.mora -= takeMora;
                remainingToPay -= takeMora;
            }
            if (remainingToPay > 0) {
                const xpPenalty = Math.floor(remainingToPay * 2);
                if (userData.xp >= xpPenalty) userData.xp -= xpPenalty; else { userData.xp = 0; if (userData.level > 1) userData.level -= 1; }
                remainingToPay = 0; 
            }
            client.setLevel.run(userData);
            loan.remainingAmount -= paymentAmount;
            loan.lastPaymentDate = now;
            if (loan.remainingAmount <= 0) {
                sql.prepare("DELETE FROM user_loans WHERE userID = ? AND guildID = ?").run(loan.userID, loan.guildID);
            } else {
                sql.prepare("UPDATE user_loans SET remainingAmount = ?, lastPaymentDate = ? WHERE userID = ? AND guildID = ?").run(loan.remainingAmount, now, loan.userID, loan.guildID);
            }
        } catch (err) { console.error(err); }
    }
};

async function processFarmYields() {
    if (!sql.open) return;
    try {
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const farmers = sql.prepare("SELECT DISTINCT userID, guildID FROM user_farm").all();
        for (const farmer of farmers) {
            let userData = client.getLevel.get(farmer.userID, farmer.guildID);
            if (!userData) continue;
            if ((now - (userData.lastFarmYield || 0)) >= ONE_DAY) {
                const userAnimals = sql.prepare("SELECT animalID, COUNT(*) as count FROM user_farm WHERE userID = ? AND guildID = ? GROUP BY animalID").all(farmer.userID, farmer.guildID);
                let totalIncome = 0;
                for (const row of userAnimals) {
                    const animalInfo = farmAnimals.find(a => a.id === row.animalID);
                    if (animalInfo) totalIncome += (animalInfo.income_per_day * row.count);
                }
                if (totalIncome > 0) {
                    userData.mora += totalIncome;
                    userData.lastFarmYield = now;
                    client.setLevel.run(userData);
                    console.log(`[Farm] Gave ${totalIncome} mora to user ${farmer.userID}`);
                }
            }
        }
    } catch (err) { console.error("[Farm] Error processing yields:", err); }
}

async function checkTemporaryRoles(client) {
    if (!sql.open) return;
    const now = Date.now();
    const expiredRoles = sql.prepare("SELECT * FROM temporary_roles WHERE expiresAt <= ?").all(now);
    for (const record of expiredRoles) {
        try {
            const guild = client.guilds.cache.get(record.guildID);
            if (!guild) {
                sql.prepare("DELETE FROM temporary_roles WHERE userID = ? AND guildID = ? AND roleID = ?").run(record.userID, record.guildID, record.roleID);
                continue;
            }
            const member = await guild.members.fetch(record.userID).catch(() => null);
            const role = guild.roles.cache.get(record.roleID);
            if (member && role) {
                await member.roles.remove(role, "انتهاء مدة الرتبة المؤقتة");
                console.log(`[Temp Roles] Removed role ${role.name} from ${member.user.tag}`);
            }
        } catch (e) { console.error(`[Temp Roles Error]: ${e.message}`); }
        sql.prepare("DELETE FROM temporary_roles WHERE userID = ? AND guildID = ? AND roleID = ?").run(record.userID, record.guildID, record.roleID);
    }
}

const calculateInterest = () => {
    if (!sql.open) return;
    const now = Date.now();
    const INTEREST_RATE = 0.0005; 
    const COOLDOWN = 24 * 60 * 60 * 1000; 
    const INACTIVITY_LIMIT = 7 * 24 * 60 * 60 * 1000; 
    const allUsers = sql.prepare("SELECT * FROM levels WHERE bank > 0").all();
    for (const user of allUsers) {
        if ((now - user.lastInterest) >= COOLDOWN) {
            const timeSinceDaily = now - (user.lastDaily || 0);
            const timeSinceWork = now - (user.lastWork || 0);
            if (timeSinceDaily > INACTIVITY_LIMIT && timeSinceWork > INACTIVITY_LIMIT) {
                sql.prepare("UPDATE levels SET lastInterest = ? WHERE user = ? AND guild = ?").run(now, user.user, user.guild);
                continue; 
            }
            const interestAmount = Math.floor(user.bank * INTEREST_RATE);
            if (interestAmount > 0) {
                sql.prepare("UPDATE levels SET bank = bank + ?, lastInterest = ?, totalInterestEarned = totalInterestEarned + ? WHERE user = ? AND guild = ?").run(interestAmount, now, interestAmount, user.user, user.guild);
            } else {
                sql.prepare("UPDATE levels SET lastInterest = ? WHERE user = ? AND guild = ?").run(now, user.user, user.guild);
            }
        }
    }
};

async function updateTimerChannels(client) {
    if (!sql.open) return;
    const guilds = client.guilds.cache.values();
    const KSA_OFFSET = 3 * 60 * 60 * 1000; 
    for (const guild of guilds) {
        const settings = sql.prepare("SELECT streakTimerChannelID, dailyTimerChannelID, weeklyTimerChannelID FROM settings WHERE guild = ?").get(guild.id);
        if (!settings) continue;
        const now = new Date();
        const nowKSA = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + KSA_OFFSET);

        const endOfDay = new Date(nowKSA); endOfDay.setHours(24, 0, 0, 0);
        const msUntilDaily = endOfDay - nowKSA;
        const hDaily = Math.floor(msUntilDaily / (1000 * 60 * 60));
        const mDaily = Math.floor((msUntilDaily % (1000 * 60 * 60)) / (1000 * 60));
        const dailyText = `${hDaily} سـ ${mDaily} د`;

        const endOfWeek = new Date(nowKSA);
        const dayOfWeek = nowKSA.getDay(); 
        const daysUntilFriday = (5 + 7 - dayOfWeek) % 7; 
        endOfWeek.setDate(nowKSA.getDate() + daysUntilFriday + (daysUntilFriday === 0 && nowKSA.getHours() >= 0 ? 7 : 0));
        endOfWeek.setHours(24, 0, 0, 0); 
        const msUntilWeekly = endOfWeek - nowKSA;
        const dWeekly = Math.floor(msUntilWeekly / (1000 * 60 * 60 * 24));
        const hWeekly = Math.floor((msUntilWeekly % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const weeklyText = `${dWeekly} يـ ${hWeekly} سـ`;

        const updateChannel = async (channelId, prefix, timeText) => {
            if (!channelId) return;
            try {
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    const newName = `${prefix} ${timeText}`;
                    if (channel.name !== newName) await channel.setName(newName);
                }
            } catch (e) { }
        };
        await updateChannel(settings.streakTimerChannelID, '🔥〢الـستـريـك:', dailyText);
        await updateChannel(settings.dailyTimerChannelID, '🏆〢مهام اليومية:', dailyText);
        await updateChannel(settings.weeklyTimerChannelID, '🔮〢مهام اسبوعية:', weeklyText);
    }
}

async function updateRainbowRoles(client) {
    if (!sql.open) return;
    try {
        const rainbowRoles = sql.prepare("SELECT roleID, guildID FROM rainbow_roles").all();
        if (rainbowRoles.length === 0) return;
        const randomColor = Math.floor(Math.random() * 16777215);
        for (const record of rainbowRoles) {
            const guild = client.guilds.cache.get(record.guildID);
            if (!guild) continue;
            const role = guild.roles.cache.get(record.roleID);
            if (role) await role.edit({ color: randomColor }).catch(() => {});
            else sql.prepare("DELETE FROM rainbow_roles WHERE roleID = ?").run(record.roleID);
        }
    } catch (e) { console.error("[Rainbow Roles Error]", e); }
}

// ==================================================================
// 6. Start Bot
// ==================================================================
client.on(Events.ClientReady, async () => { 
    console.log(`✅ Logged in as ${client.user.username}`);
    
    client.antiRolesCache = new Map();
    await loadRoleSettings(sql, client.antiRolesCache);

    const rest = new REST({ version: '10' }).setToken(botToken);
    const commands = [];
    const loadedCommandNames = new Set();

    function getFiles(dir) {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        let commandFiles = [];
        for (const file of files) {
            if (file.isDirectory()) commandFiles = [...commandFiles, ...getFiles(path.join(dir, file.name))];
            else if (file.name.endsWith('.js')) commandFiles.push(path.join(dir, file.name));
        }
        return commandFiles;
    }
    const commandFiles = getFiles(path.join(__dirname, 'commands'));
    for (const file of commandFiles) {
        try {
            const command = require(file);
            const cmdName = command.data ? command.data.name : command.name;
            if (cmdName) {
                if (loadedCommandNames.has(cmdName)) { console.warn(`⚠️ Ignored duplicate: ${cmdName}`); continue; }
                loadedCommandNames.add(cmdName);
                if (command.data) commands.push(command.data.toJSON());
                if ('execute' in command) client.commands.set(cmdName, command);
            }
        } catch (err) { console.error(`[Load Error] ${file}:`, err.message); }
    }
    try { 
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); 
        console.log(`✅ Successfully reloaded ${commands.length} application (/) commands.`); 
    } catch (error) { console.error("[Deploy Error]", error); }

    setInterval(calculateInterest, 60 * 60 * 1000); calculateInterest();
    setInterval(updateMarketPrices, 60 * 60 * 1000); updateMarketPrices();
    setInterval(checkLoanPayments, 60 * 60 * 1000);
    setInterval(processFarmYields, 60 * 60 * 1000); processFarmYields();
    setInterval(() => checkDailyStreaks(client, sql), 3600000); checkDailyStreaks(client, sql);
    setInterval(() => checkDailyMediaStreaks(client, sql), 3600000); checkDailyMediaStreaks(client, sql);
    setInterval(() => checkUnjailTask(client), 5 * 60 * 1000); checkUnjailTask(client);
    setInterval(() => checkTemporaryRoles(client), 60000); checkTemporaryRoles(client);
    setInterval(() => updateTimerChannels(client), 5 * 60 * 1000); updateTimerChannels(client); 
    setInterval(() => updateRainbowRoles(client), 180000); 

    let lastReminderSentHour = -1; let lastUpdateSentHour = -1; let lastWarningSentHour = -1; 
    setInterval(() => { 
        const KSA_TIMEZONE = 'Asia/Riyadh'; 
        const nowKSA = new Date().toLocaleString('en-US', { timeZone: KSA_TIMEZONE }); 
        const ksaDate = new Date(nowKSA); 
        const ksaHour = ksaDate.getHours(); 
        if (ksaHour === 0 && lastUpdateSentHour !== ksaHour) { 
            sendDailyMediaUpdate(client, sql); 
            lastUpdateSentHour = ksaHour; 
        } else if (ksaHour !== 0) lastUpdateSentHour = -1; 
        if (ksaHour === 12 && lastWarningSentHour !== ksaHour) { 
            sendStreakWarnings(client, sql); 
            lastWarningSentHour = ksaHour; 
        } else if (ksaHour !== 12) lastWarningSentHour = -1; 
        if (ksaHour === 15 && lastReminderSentHour !== ksaHour) { 
            sendMediaStreakReminders(client, sql); 
            lastReminderSentHour = ksaHour; 
        } else if (ksaHour !== 15) lastReminderSentHour = -1; 
    }, 60000); 
    
    const lastRandomGiveawayDate = new Map(); setInterval(async () => { const today = new Date().toISOString().split('T')[0]; const now = Date.now(); for (const guild of client.guilds.cache.values()) { const guildID = guild.id; if (lastRandomGiveawayDate.get(guildID) === today) continue; const guildTimestamps = client.recentMessageTimestamps.get(guildID) || []; while (guildTimestamps.length > 0 && guildTimestamps[0] < (now - RECENT_MESSAGE_WINDOW)) { guildTimestamps.shift(); } const totalMessagesLast2Hours = guildTimestamps.length; if (totalMessagesLast2Hours < 200) continue; const roll = Math.random(); if (roll < 0.10) { try { const success = await createRandomDropGiveaway(client, guild); if (success) { lastRandomGiveawayDate.set(guildID, today); console.log(`[DropGA] Success: ${guild.name}`); } } catch (err) { console.error(`[DropGA] Error:`, err.message); } } } }, 30 * 60 * 1000); 
    
    sendDailyMediaUpdate(client, sql);
}); 

require('./interaction-handler.js')(client, sql, client.antiRolesCache);

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) { const filePath = path.join(eventsPath, file); const event = require(filePath); if (event.once) { client.once(event.name, (...args) => event.execute(...args)); } else { client.on(event.name, (...args) => event.execute(...args)); } }
console.log("[System] Events Loaded.");

client.login(botToken);
