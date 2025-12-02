const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Colors, SlashCommandBuilder } = require("discord.js");
const path = require('path');

// --- ( 🌟 الحل الجذري للمسارات: استخدام المسار الرئيسي للبوت 🌟 ) ---
const rootDir = process.cwd(); // هذا يجيب المسار الرئيسي للمشروع

// بما أن الملف في commands/top.js، نحتاج للمسارات التالية:
const weaponsConfigPath = path.join(rootDir, 'json', 'weapons-config.json');
const pvpCorePath = path.join(rootDir, 'handlers', 'pvp-core.js');

const weaponsConfig = require(weaponsConfigPath); 
const { getUserRace, getWeaponData, BASE_HP, HP_PER_LEVEL } = require(pvpCorePath); 
// -------------------------------------------------------------------

const EMOJI_MORA = '<:mora:1435647151349698621>';
const EMOJI_MEDIA_STREAK = '<a:Streak:1438932297519730808>';
const ROWS_PER_PAGE = 5; 

const IMAGES = {
    level: 'https://i.postimg.cc/9FWddtV8/123.png',
    mora: 'https://i.postimg.cc/8zHz1PXG/download-2.jpg',
    streak: 'https://i.postimg.cc/NfLYXwD5/123.jpg',
    media_streak: 'https://i.postimg.cc/NfLYXwD5/123.jpg',
    strongest: 'https://i.postimg.cc/pL7PLmf0/power.webp',
    weekly_xp: 'https://i.postimg.cc/9FWddtV8/123.png',
    daily_xp: 'https://i.postimg.cc/9FWddtV8/123.png',
    monthly_xp: 'https://i.postimg.cc/9FWddtV8/123.png', // (صورة الشهر)
    achievements: 'https://i.postimg.cc/bwxwsnvs/qaʿt-alanjazat.png'
};

function getRankEmoji(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
}

function getWeekStartDateString() {
    const now = new Date();
    const diff = now.getUTCDate() - (now.getUTCDay() + 2) % 7;
    const friday = new Date(now.setUTCDate(diff));
    friday.setUTCHours(0, 0, 0, 0);
    return friday.toISOString().split('T')[0];
}

function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

function getMonthStartDateString() {
    const now = new Date();
    const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return firstDay.toISOString().split('T')[0];
}

function getTimeRemaining(type) {
    const now = new Date();
    const ksaOffset = 3 * 60 * 60 * 1000;
    const nowKSA = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + ksaOffset);

    let end;
    if (type === 'daily') {
        end = new Date(nowKSA);
        end.setHours(24, 0, 0, 0);
    } else if (type === 'weekly') { 
        end = new Date(nowKSA);
        const day = nowKSA.getDay();
        const diff = (5 - day + 7) % 7; 
        end.setDate(nowKSA.getDate() + diff + (diff === 0 && nowKSA.getHours() >= 0 ? 7 : 0));
        end.setHours(0, 0, 0, 0);
    } else if (type === 'monthly') {
        end = new Date(Date.UTC(nowKSA.getUTCFullYear(), nowKSA.getUTCMonth() + 1, 1));
    }
    
    const ms = end - nowKSA;
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));
    const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (d > 0) return `${d} يـ ${h} سـ`;
    return `${h} سـ ${m} د`;
}

async function generateLeaderboard(sql, guild, type, page, targetUserId = null) {
    const embed = new EmbedBuilder().setColor("Random").setImage(IMAGES[type] || null);

    let description = "";
    let allUsers = [];
    let totalPages = 0;

    try {
        if (type === 'level') {
            embed.setTitle(`✥ اعـلـى الـمصـنـفـيـن بالمسـتويات`);
            allUsers = sql.prepare("SELECT * FROM levels WHERE guild = ? ORDER BY totalXP DESC").all(guild.id);
            
        } else if (type === 'weekly_xp') {
            embed.setTitle(`✥ اعـلـى الـمصـنـفـيـن في الاسبـوع`);
            const weekStart = getWeekStartDateString();
            allUsers = sql.prepare(`SELECT *, (messages * 15 + vc_minutes * 10) as score FROM user_weekly_stats WHERE guildID = ? AND weekStartDate = ? AND score > 0 ORDER BY score DESC`).all(guild.id, weekStart);
            embed.setFooter({ text: `باقي: ${getTimeRemaining('weekly')} لتـحديـث الترتيـب` });

        } else if (type === 'daily_xp') {
            embed.setTitle(`✥ اعـلـى الـمصـنـفـيـن اليـوم`);
            const today = getTodayDateString();
            allUsers = sql.prepare(`SELECT *, (messages * 15 + vc_minutes * 10) as score FROM user_daily_stats WHERE guildID = ? AND date = ? AND score > 0 ORDER BY score DESC`).all(guild.id, today);
            embed.setFooter({ text: `باقي: ${getTimeRemaining('daily')} لتـحديـث الترتيـب` });

        } else if (type === 'monthly_xp') {
            embed.setTitle(`✥ اعـلـى الـمصـنـفـيـن لـهذا الـشـهـر`);
            const monthStart = getMonthStartDateString();
            allUsers = sql.prepare(`
                SELECT userID, SUM(messages * 15 + vc_minutes * 10) as score 
                FROM user_daily_stats 
                WHERE guildID = ? AND date >= ? 
                GROUP BY userID 
                HAVING score > 0 
                ORDER BY score DESC
            `).all(guild.id, monthStart);
            embed.setFooter({ text: `باقي: ${getTimeRemaining('monthly')} لتـحديـث الترتيـب` });

        } else if (type === 'mora') {
            embed.setTitle(`<:mora:1435647151349698621> اثـريـاء الـسيرفـر`);
            allUsers = sql.prepare("SELECT * FROM levels WHERE guild = ? ORDER BY (mora + bank) DESC").all(guild.id);
            const totalMora = sql.prepare("SELECT SUM(mora + bank) as t FROM levels WHERE guild = ?").get(guild.id).t || 0;
            embed.setFooter({ text: `اجمالي المورا: ${totalMora.toLocaleString()}` });

        } else if (type === 'streak') {
            embed.setTitle(`✥ اعـلـى الـمصـنـفـيـن بالـستـريـك`);
            allUsers = sql.prepare("SELECT * FROM streaks WHERE guildID = ? AND streakCount > 0 ORDER BY streakCount DESC").all(guild.id);
            
        } else if (type === 'media_streak') {
            embed.setTitle(`✥ اعـلـى الـمصـنـفـيـن بستـريـك المـيـديـا`);
            allUsers = sql.prepare("SELECT * FROM media_streaks WHERE guildID = ? AND streakCount > 0 ORDER BY streakCount DESC").all(guild.id);

        } else if (type === 'achievements') {
            embed.setTitle(`🏆 اعـلـى الـمصـنـفـيـن بالإنجازات`);
            allUsers = sql.prepare("SELECT userID, COUNT(*) as count FROM user_achievements WHERE guildID = ? GROUP BY userID ORDER BY count DESC").all(guild.id);

        } else if (type === 'strongest') {
            embed.setTitle(`✥ لوحـة صـدارة الاقـوى`);
            const weapons = sql.prepare("SELECT * FROM user_weapons WHERE guildID = ?").all(guild.id);
            let stats = [];
            const getLvl = sql.prepare("SELECT level FROM levels WHERE guild = ? AND user = ?");
            const getSkills = sql.prepare("SELECT COUNT(*) as c FROM user_skills WHERE guildID = ? AND userID = ?");
            
            for (const w of weapons) {
                const conf = weaponsConfig.find(c => c.race === w.raceName);
                if(!conf) continue;
                const dmg = conf.base_damage + (conf.damage_increment * (w.weaponLevel - 1));
                const lvlData = getLvl.get(guild.id, w.userID);
                const hp = BASE_HP + ((lvlData?.level || 1) * HP_PER_LEVEL);
                const skills = getSkills.get(guild.id, w.userID).c;
                stats.push({ userID: w.userID, damage: dmg, hp, level: w.weaponLevel, skillCount: skills });
            }
            allUsers = stats.sort((a, b) => b.damage - a.damage);
        }

        if (targetUserId) {
            const index = allUsers.findIndex(u => (u.user || u.userID) === targetUserId);
            if (index !== -1) {
                page = Math.ceil((index + 1) / ROWS_PER_PAGE);
            }
        }

        totalPages = Math.ceil(allUsers.length / ROWS_PER_PAGE) || 1;
        page = Math.max(1, Math.min(page, totalPages));

        let currentFooter = embed.data.footer ? embed.data.footer.text : "";
        embed.setFooter({ text: `${currentFooter ? currentFooter + " | " : ""}صفحة ${page} / ${totalPages}` });

        const pageData = allUsers.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

        if (pageData.length === 0) {
            description = "لا يوجد بيانات لعرضها حالياً.";
        } else {
            for (let i = 0; i < pageData.length; i++) {
                const user = pageData[i];
                const uID = user.user || user.userID;
                const rank = (page - 1) * ROWS_PER_PAGE + i + 1;
                const rankEmoji = getRankEmoji(rank);
                
                const isMe = uID === targetUserId;
                const pin = isMe ? "📍 " : ""; 
                const styleStart = isMe ? "**" : ""; 
                const styleEnd = isMe ? "**" : "";
                
                let line = `${rankEmoji} ${pin}<@${uID}>\n`;

                if (type === 'level') line += `> ${styleStart}XP: \`${user.totalXP.toLocaleString()}\` (Lvl: ${user.level})${styleEnd}`;
                else if (type === 'weekly_xp' || type === 'daily_xp' || type === 'monthly_xp') line += `> ${styleStart}Score: \`${(user.score||0).toLocaleString()}\`${styleEnd}`;
                else if (type === 'mora') line += `> ${styleStart}Mora: \`${((user.mora||0) + (user.bank||0)).toLocaleString()}\` ${EMOJI_MORA}${styleEnd}`;
                else if (type === 'streak' || type === 'media_streak') line += `> ${styleStart}Streak: \`${user.streakCount}\` ${type === 'media_streak' ? EMOJI_MEDIA_STREAK : '🔥'}${styleEnd}`;
                else if (type === 'achievements') line += `> ${styleStart}Count: \`${user.count}\` 🏆${styleEnd}`;
                else if (type === 'strongest') line += `> ${styleStart}DMG: \`${user.damage}\` | HP: \`${user.hp}\`${styleEnd}`;

                description += line + "\n\n";
            }
        }
        embed.setDescription(description);
        return { embed, totalPages, currentPage: page };

    } catch (err) {
        console.error(`[Leaderboard Error] ${type}:`, err);
        embed.setDescription("حدث خطأ أثناء جلب البيانات.");
        return { embed, totalPages: 1, currentPage: 1 };
    }
}

function createButtons(activeId, page, totalPages) {
    const rowCat = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('top_level').setEmoji('<a:levelup:1437805366048985290>').setStyle(activeId === 'level' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('top_mora').setEmoji('<:mora:1435647151349698621>').setStyle(activeId === 'mora' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('top_streak').setEmoji('🔥').setStyle((activeId === 'streak' || activeId === 'media_streak') ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('top_strongest').setEmoji('⚔️').setStyle(activeId === 'strongest' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('top_achievements').setEmoji('<a:mTrophy:1438797228826300518>').setStyle(activeId === 'achievements' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    const rowNav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('leaderboard_prev').setEmoji('<:left:1439164494759723029>').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId('leaderboard_find_me').setEmoji('📍').setStyle(ButtonStyle.Success), 
        new ButtonBuilder().setCustomId('leaderboard_next').setEmoji('<:right:1439164491072929915>').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
    );
    
    return [rowCat, rowNav];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('توب')
        .setDescription('عرض لوحات الصدارة.')
        .addStringOption(opt => opt.setName('التصنيف').setDescription('نوع الترتيب').addChoices(
            { name: 'Level', value: 'level' }, { name: 'Mora', value: 'mora' },
            { name: 'Streak', value: 'streak' }, { name: 'Strongest', value: 'strongest' },
            { name: 'Achievements', value: 'achievements' }, { name: 'Weekly', value: 'weekly_xp' },
            { name: 'Daily', value: 'daily_xp' }, { name: 'Monthly', value: 'monthly_xp' }
        ))
        .addIntegerOption(opt => opt.setName('صفحة').setDescription('رقم الصفحة')),

    name: "top",
    aliases: ["توب", "المتصدرين", "topmora", "topstreak", "اغنى", "اقوى", "topweek", "توب-الاسبوع", "t", "lb"],
    category: "Leveling",
    cooldown: 10,
    description: "يعرض لوحات الصدارة.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, user, channelId;
        let currentPage = 1;
        let argType = 'level'; 

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            user = interaction.user;
            channelId = interaction.channelId;
            currentPage = interaction.options.getInteger('صفحة') || 1;
            argType = interaction.options.getString('التصنيف') || 'level';
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            user = message.author;
            channelId = message.channel.id;
            
            // ( 🌟 الكشف التلقائي عن الكازينو 🌟 )
            const settings = client.sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?").get(guild.id);
            if (settings && settings.casinoChannelID === channelId) {
                argType = 'mora'; 
            }

            const cmd = message.content.split(' ')[0].slice(1).toLowerCase(); 
            if (cmd.includes('mora') || cmd.includes('اغنى')) argType = 'mora';
            else if (cmd.includes('streak')) argType = 'streak';
            else if (cmd.includes('week') || cmd.includes('اسبوع')) argType = 'weekly_xp';
            else if (cmd.includes('month') || cmd.includes('شهر')) argType = 'monthly_xp';
            else if (cmd.includes('daily') || cmd.includes('يومي')) argType = 'daily_xp';
            else if (cmd.includes('اقوى')) argType = 'strongest';
            else if (cmd.includes('achievements') || cmd.includes('انجازات')) argType = 'achievements';
            
            if (args && args.length > 0) {
                const firstArg = args[0].toLowerCase();
                if (['week', 'weekly', 'w', 'اسبوع', 'اسبوعي'].includes(firstArg)) argType = 'weekly_xp';
                else if (['month', 'monthly', 'm', 'شهر', 'شهري'].includes(firstArg)) argType = 'monthly_xp';
                else if (['day', 'daily', 'd', 'يومي', 'يوم'].includes(firstArg)) argType = 'daily_xp';
                else if (['mora', 'money', 'coins', 'مورا', 'فلوس'].includes(firstArg)) argType = 'mora';
                else if (['streak', 'st', 'ستريك'].includes(firstArg)) argType = 'streak';
                else if (['achievements', 'ach', 'انجازات'].includes(firstArg)) argType = 'achievements';
                
                const potentialPage = parseInt(firstArg);
                if (!isNaN(potentialPage)) currentPage = potentialPage;
                else if (args[1] && !isNaN(parseInt(args[1]))) currentPage = parseInt(args[1]);
            }
        }

        const sql = client.sql;
        const reply = async (payload) => isSlash ? interaction.editReply(payload) : message.channel.send(payload);

        const data = await generateLeaderboard(sql, guild, argType, currentPage);
        currentPage = data.currentPage;
        
        const msg = await reply({ 
            embeds: [data.embed], 
            components: createButtons(argType, currentPage, data.totalPages) 
        });

        const collector = msg.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            idle: 60000 
        });

        collector.on('collect', async i => {
            if (i.user.id !== user.id) return i.reply({ content: "هذه القائمة ليست لك.", ephemeral: true });
            
            if (i.customId === 'leaderboard_next') currentPage++;
            else if (i.customId === 'leaderboard_prev') currentPage--;
            else if (i.customId === 'leaderboard_find_me') {
                const findData = await generateLeaderboard(sql, guild, argType, 1, user.id);
                if (findData.totalPages === 0) { 
                     return i.reply({ content: "لست موجوداً في هذا التصنيف!", ephemeral: true });
                }
                currentPage = findData.currentPage; 
            } 
            else if (i.customId.startsWith('top_')) {
                const clicked = i.customId.replace('top_', '');
                if (clicked === 'level') {
                    if (argType === 'level') argType = 'weekly_xp';
                    else if (argType === 'weekly_xp') argType = 'monthly_xp'; // (إضافة الشهري للتدوير)
                    else if (argType === 'monthly_xp') argType = 'daily_xp';
                    else argType = 'level';
                } else if (clicked === 'streak') {
                    argType = (argType === 'streak') ? 'media_streak' : 'streak';
                } else {
                    argType = clicked;
                }
                currentPage = 1;
            }

            const newData = await generateLeaderboard(sql, guild, argType, currentPage, (i.customId === 'leaderboard_find_me' ? user.id : null));
            await i.update({ 
                embeds: [newData.embed], 
                components: createButtons(argType, newData.currentPage, newData.totalPages) 
            });
            currentPage = newData.currentPage; 
        });

        collector.on('end', () => msg.edit({ components: [] }).catch(() => {}));
    },
    generateLeaderboard 
};
