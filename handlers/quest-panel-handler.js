const { EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require("discord.js");
// ( 🌟 تأكد من صحة المسار لملف achievements.js و top.js 🌟 )
const { buildAchievementsEmbed, buildDailyEmbed, buildWeeklyEmbed } = require('../commands/achievements.js');
const { generateLeaderboard } = require('../commands/leveling/top.js'); 
const questsConfig = require('../json/quests-config.json');

const EMOJI_MORA = '<:mora:1435647151349698621>';
const EMOJI_STAR = '⭐';

// --- الدوال المساعدة ---
function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function getWeekStartDateString() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); 
    const diff = now.getUTCDate() - (dayOfWeek + 2) % 7;
    const friday = new Date(now.setUTCDate(diff));
    friday.setUTCHours(0, 0, 0, 0);
    return friday.toISOString().split('T')[0];
}

function createNotifButton(label, customId, currentStatus) {
    const isEnabled = currentStatus === 1;
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(`${label}: ${isEnabled ? 'مفعل ✅' : 'معطل ❌'}`)
        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger);
}

// --- دالة إنجازاتي (My Achievements) ---
async function buildMyAchievementsEmbed(interaction, sql, page = 1) {
    try {
        const completed = sql.prepare("SELECT * FROM user_achievements WHERE userID = ? AND guildID = ?").all(interaction.user.id, interaction.guild.id);

        if (completed.length === 0) {
            return { embeds: [new EmbedBuilder().setTitle('🎖️ إنجازاتي').setColor(Colors.DarkRed).setDescription('لم تقم بإكمال أي إنجازات بعد.').setImage('https://i.postimg.cc/L4Yb4zHw/almham_alywmyt-2.png')], components: [], totalPages: 1 };
        }

        const completedIDs = new Set(completed.map(c => c.achievementID));
        const completedDetails = questsConfig.achievements.filter(ach => completedIDs.has(ach.id)); 

        const perPage = 10;
        const totalPages = Math.ceil(completedDetails.length / perPage) || 1;
        page = Math.max(1, Math.min(page, totalPages));

        const start = (page - 1) * perPage;
        const end = start + perPage;
        const achievementsToShow = completedDetails.slice(start, end); 

        const embed = new EmbedBuilder()
            .setTitle('🎖️ إنجازاتي') 
            .setColor(Colors.DarkRed)
            .setAuthor({ name: interaction.member.displayName, iconURL: interaction.user.displayAvatarURL() })
            .setFooter({ text: `صفحة ${page} / ${totalPages} (الإجمالي: ${completedDetails.length})` }) 
            .setTimestamp()
            .setImage('https://i.postimg.cc/L4Yb4zHw/almham_alywmyt-2.png');

        let description = '';
        for (const ach of achievementsToShow) {
            description += `${ach.emoji || '🏆'} **${ach.name}**\n> ${ach.description}\n> *المكافأة: ${EMOJI_MORA} \`${ach.reward.mora}\` | ${EMOJI_STAR}XP: \`${ach.reward.xp}\`*\n\n`;
        }
        embed.setDescription(description);

        return { embeds: [embed], totalPages };

    } catch (err) {
        console.error("Error building my achievements embed:", err);
        return { embeds: [new EmbedBuilder().setTitle(' خطأ').setDescription('حدث خطأ أثناء جلب إنجازاتك.').setColor(Colors.Red)], totalPages: 1 };
    }
}

// --- الدالة الرئيسية ---
async function handleQuestPanel(i, client, sql) {
    const userId = i.user.id;
    const guildId = i.guild.id;
    const id = `${userId}-${guildId}`;
    
    let currentPage = 1;
    let section = "";

    // 1. تحليل التفاعل (قائمة أو زر)
    if (i.isStringSelectMenu()) {
        // ( 🌟 هنا كان الخلل: values[0] قد تكون 'empire' أو غيرها )
        section = i.values[0];
        await i.deferUpdate(); 
    } else if (i.isButton()) {
        const parts = i.customId.split('_');
        // ID: panel_SECTION_prev_PAGE
        const action = parts[parts.length - 2]; // prev/next
        const pageNum = parseInt(parts[parts.length - 1]);
        section = parts.slice(1, parts.length - 2).join('_'); // تجميع اسم القسم
        
        currentPage = pageNum;
        if (action === 'prev') currentPage--;
        if (action === 'next') currentPage++;
        
        await i.deferUpdate();
    } else {
        await i.deferReply({ ephemeral: true });
        section = i.customId.replace('panel_', '');
    }

    // ( 🌟 معالجة خاصة لقسم الإمبراطورية empire 🌟 )
    if (section === 'empire') {
         return i.followUp({ content: "🚧 **قسم مهام الإمبراطورية قيد التطوير حالياً!**", ephemeral: true });
    }

    // 2. منطق الإشعارات
    if (section.includes('toggle_notif') || section === 'notifications') {
        let notifData = client.getQuestNotif.get(id);
        if (!notifData) {
            notifData = { id: id, userID: userId, guildID: guildId, dailyNotif: 1, weeklyNotif: 1, achievementsNotif: 1, levelNotif: 1 };
            client.setQuestNotif.run(notifData);
        }
        if (typeof notifData.levelNotif === 'undefined') notifData.levelNotif = 1;

        if (section.includes('toggle_notif')) {
            if (section.endsWith('daily')) notifData.dailyNotif = notifData.dailyNotif === 1 ? 0 : 1;
            else if (section.endsWith('weekly')) notifData.weeklyNotif = notifData.weeklyNotif === 1 ? 0 : 1;
            else if (section.endsWith('ach')) notifData.achievementsNotif = notifData.achievementsNotif === 1 ? 0 : 1;
            else if (section.endsWith('level')) notifData.levelNotif = notifData.levelNotif === 1 ? 0 : 1;
            client.setQuestNotif.run(notifData);
        }

        const notifEmbed = new EmbedBuilder().setTitle('🔔 إعدادات الإشعارات').setDescription('قم بتحديد الإشعارات التي ترغب بتفعيلها أو تعطيلها.').setColor(Colors.Purple).setImage('https://i.postimg.cc/5217mTwV/almham_alywmyt-3.png');
        const notifButtons = new ActionRowBuilder().addComponents(
            createNotifButton('المهام اليومية', 'panel_toggle_notif_daily', notifData.dailyNotif),
            createNotifButton('المهام الأسبوعية', 'panel_toggle_notif_weekly', notifData.weeklyNotif),
            createNotifButton('الإنجازات', 'panel_toggle_notif_ach', notifData.achievementsNotif),
            createNotifButton('زيادة المستوى', 'panel_toggle_notif_level', notifData.levelNotif)
        );
        return await i.editReply({ embeds: [notifEmbed], components: [notifButtons], files: [] });
    }

    // 3. جلب البيانات للأقسام الأخرى
    const dateStr = getTodayDateString();
    const weekStartDateStr = getWeekStartDateString();
    const totalStatsId = `${userId}-${guildId}`;
    
    const levelData = client.getLevel.get(userId, guildId) || { ...client.defaultData, user: userId, guild: guildId };
    const dailyStats = client.getDailyStats.get(`${userId}-${guildId}-${dateStr}`) || {};
    const weeklyStats = client.getWeeklyStats.get(`${userId}-${guildId}-${weekStartDateStr}`) || {};
    const totalStats = client.getTotalStats.get(totalStatsId) || {};
    const completedAchievements = sql.prepare("SELECT * FROM user_achievements WHERE userID = ? AND guildID = ?").all(userId, guildId);

    let embeds = [];
    let files = [];
    let totalPages = 1;
    let data;

    // ( 🌟 التوجيه الصحيح للأقسام 🌟 )
    if (section === 'daily') {
        data = await buildDailyEmbed(sql, i.member, dailyStats, currentPage);
    } else if (section === 'weekly') {
        data = await buildWeeklyEmbed(sql, i.member, weeklyStats, currentPage);
    } else if (section === 'top_achievements') {
        data = await generateLeaderboard(sql, i.guild, 'achievements', currentPage);
    } else if (section === 'my_achievements') {
        data = await buildMyAchievementsEmbed(i, sql, currentPage);
    } else if (section === 'achievements') { // القائمة العامة للإنجازات
        data = await buildAchievementsEmbed(sql, i.member, levelData, totalStats, completedAchievements, currentPage);
    } else {
        // إذا القسم غير معروف (مثل empire القديمة)
        return i.followUp({ content: "❌ هذا القسم غير متوفر حالياً أو تم نقله.", ephemeral: true });
    }

    if (data) {
        embeds = Array.isArray(data.embeds) ? data.embeds : [data.embed];
        files = data.files || [];
        totalPages = data.totalPages || 1;
        currentPage = Math.max(1, Math.min(currentPage, totalPages));
    }

    let components = [];
    if (totalPages > 1) {
        const pageRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`panel_${section}_prev_${currentPage}`).setStyle(ButtonStyle.Secondary).setEmoji('<:left:1439164494759723029>').setDisabled(currentPage === 1),
            new ButtonBuilder().setCustomId(`panel_${section}_next_${currentPage}`).setStyle(ButtonStyle.Secondary).setEmoji('<:right:1439164491072929915>').setDisabled(currentPage === totalPages)
        );
        components.push(pageRow);
    }

    await i.editReply({ embeds: embeds, files: files, components: components });
}

module.exports = { handleQuestPanel };
