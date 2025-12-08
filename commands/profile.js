const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Colors, AttachmentBuilder, SlashCommandBuilder } = require("discord.js");
const { calculateBuffMultiplier, calculateMoraBuff } = require("../streak-handler.js");
const { getUserRace, getWeaponData, BASE_HP, HP_PER_LEVEL } = require('../handlers/pvp-core.js'); 
const weaponsConfig = require('../json/weapons-config.json');
const { createCanvas, loadImage } = require('canvas'); // ❌ تم حذف registerFont
const path = require('path');

// --- ( 1. تعريف الخط الموحد ) ---
// نستخدم الاسم "Bein" الذي سجلناه في ملف index.js
const FONT_MAIN = 'Bein'; 

const RACE_TRANSLATIONS = new Map([
    ['Human', 'بشري'],
    ['Dragon', 'تنين'],
    ['Elf', 'آلف'],
    ['Dark Elf', 'آلف الظلام'],
    ['Seraphim', 'سيرافيم'],
    ['Demon', 'شيطان'],
    ['Vampire', 'مصاص دماء'],
    ['Spirit', 'روح'],
    ['Dwarf', 'قزم'],
    ['Ghoul', 'غول'],
    ['Hybrid', 'نصف وحش']
]);

// --- ( دالة رسم النص مع الأيقونة ) ---
async function drawTextWithIcon(ctx, text, x, y, iconUrl) {
    // 1. رسم النص (الأرقام)
    ctx.fillText(text, x, y);

    // 2. حساب عرض النص
    const textWidth = ctx.measureText(text).width;

    if (iconUrl) {
        try {
            const img = await loadImage(iconUrl);
            const iconSize = 18;
            const gap = 6; 
            ctx.drawImage(img, x - textWidth - gap - iconSize, y - 19, iconSize, iconSize); 
        } catch (e) {
            // تجاهل الخطأ
        }
    }
}

function roundRect(ctx, x, y, width, height, radius) {
    if (width < 2 * radius) radius = width / 2;
    if (height < 2 * radius) radius = height / 2;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

async function buildGeneralProfile(client, member, targetUser) {
    const sql = client.sql;
    const getLevel = client.getLevel;
    const score = getLevel.get(targetUser.id, member.guild.id);

    const level = score ? score.level : 0;
    const totalXP = score ? score.totalXP : 0;
    const currentXP_Progress = score ? score.xp : 0;
    const mora = score ? (score.mora || 0) : 0;
    const bank = score ? (score.bank || 0) : 0;
    const totalMora = mora + bank;
    const allScores = sql.prepare("SELECT user FROM levels WHERE guild = ? ORDER BY totalXP DESC").all(member.guild.id);
    const rank = allScores.findIndex(s => s.user === targetUser.id) + 1;
    const rankStr = rank > 0 ? `${rank}` : "0";
    const allMora = sql.prepare("SELECT user FROM levels WHERE guild = ? ORDER BY (mora + bank) DESC").all(member.guild.id);
    const moraRank = allMora.findIndex(s => s.user === targetUser.id) + 1;
    const moraRankStr = moraRank > 0 ? `${moraRank}` : "0";
    const allStreaks = sql.prepare("SELECT userID FROM streaks WHERE guildID = ? ORDER BY streakCount DESC").all(member.guild.id);
    const streakRank = allStreaks.findIndex(s => s.userID === targetUser.id) + 1;
    const streakRankStr = streakRank > 0 ? `${streakRank}` : "0";
    const allStrongest = sql.prepare("SELECT userID, raceName, weaponLevel FROM user_weapons WHERE guildID = ? AND weaponLevel > 0").all(member.guild.id)
        .map(w => {
            const config = weaponsConfig.find(c => c.race === w.raceName);
            const damage = config ? config.base_damage + (config.damage_increment * (w.weaponLevel - 1)) : 0;
            return { userID: w.userID, damage: damage };
        })
        .sort((a, b) => b.damage - a.damage);
    const strongestRank = allStrongest.findIndex(s => s.userID === targetUser.id) + 1;
    const strongestRankStr = strongestRank > 0 ? `${strongestRank}` : "0";
    const buffMultiplier = calculateBuffMultiplier(member, sql);
    const totalBuffPercent = (buffMultiplier - 1) * 100;
    const buffString = `${totalBuffPercent.toFixed(0)}%`;
    const moraBuffMultiplier = calculateMoraBuff(member, sql);
    const moraBuffPercent = (moraBuffMultiplier - 1) * 100;
    const moraBuffString = `${moraBuffPercent.toFixed(0)}%`;
    const streakData = sql.prepare("SELECT * FROM streaks WHERE guildID = ? AND userID = ?").get(member.guild.id, targetUser.id);
    let hasItemShields = (streakData && streakData.hasItemShield) ? streakData.hasItemShield : 0;
    let hasGraceShield = (streakData && streakData.hasGracePeriod === 1) ? 1 : 0;
    let totalShields = hasItemShields + hasGraceShield;
    let shieldText = `${totalShields}`; 
    const streakCount = (streakData && streakData.streakCount) ? streakData.streakCount : 0;

    const background = await loadImage(path.join(__dirname, '../images/pr.png'));
    const canvas = createCanvas(background.width, background.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

    const avatarOriginalX = 284;
    const avatarOriginalY = 29;
    const avatarOriginalSize = 99;
    const avatarNewSize = avatarOriginalSize * 1;
    const avatarXOffset = 9;
    const avatarYOffset = 3;
    const avatarFinalX = avatarOriginalX - avatarXOffset;
    const avatarFinalY = avatarOriginalY - avatarYOffset;
    const avatarCircleRadius = avatarNewSize / 2;
    const avatarCircleCenterX = avatarFinalX + avatarCircleRadius;
    const avatarCircleCenterY = avatarFinalY + avatarCircleRadius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCircleCenterX, avatarCircleCenterY, avatarCircleRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png' }));
    ctx.drawImage(avatar, avatarFinalX, avatarFinalY, avatarNewSize, avatarNewSize);
    ctx.restore();

    const requiredXP = 5 * (level ** 2) + (50 * level) + 100;
    let percentage = 0;
    if (requiredXP > 0) {
        percentage = Math.max(0, Math.min(1, currentXP_Progress / requiredXP));
    }
    const barWidth = 250;
    const barHeight = 20;
    const barX = (canvas.width - barWidth) / 2;
    const barY = 165;
    const barRadius = 10;
    ctx.save();
    ctx.fillStyle = '#3D3D3D';
    roundRect(ctx, barX, barY, barWidth, barHeight, barRadius);
    ctx.fill();
    ctx.restore();
    if (percentage > 0) {
        ctx.save();
        roundRect(ctx, barX, barY, barWidth, barHeight, barRadius);
        ctx.clip();
        ctx.fillStyle = '#FFAA40';
        ctx.fillRect(barX, barY, barWidth * percentage, barHeight);
        ctx.restore();
    }
    ctx.shadowColor = '#FFAA40';
    ctx.shadowBlur = 4;
    const xpText = `${currentXP_Progress.toLocaleString()} / ${requiredXP.toLocaleString()} XP`;

    // 🌟🌟 التصحيح هنا: حذفنا كلمة bold واستخدمنا 14px عادي 🌟🌟
    ctx.font = `14px "${FONT_MAIN}"`; 
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFAA40';
    ctx.fillText(xpText, barX + (barWidth / 2), barY - 8);

    // 🌟🌟 وهنا حذفنا bold واستخدمنا 30px عادي 🌟🌟
    ctx.font = `30px "${FONT_MAIN}"`;
    ctx.textAlign = 'left';
    ctx.fillText(level, 40, 150);

    // ( البروفايل العام )
    ctx.font = `20px "${FONT_MAIN}"`; 
    ctx.textAlign = 'right';

    let moraX = 310;
    let streakX = 305; 
    let bottomX = 275;
    let rightY = 215;
    const rightLineHeight = 28;

    // 1. المورا
    ctx.fillText(totalMora.toLocaleString(), moraX, rightY);
    rightY += rightLineHeight;

    // 2. الستريك
    await drawTextWithIcon(ctx, streakCount.toLocaleString(), streakX, rightY, 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png');
    rightY += rightLineHeight;

    // 3. بف المورا
    await drawTextWithIcon(ctx, moraBuffString, bottomX, rightY, 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4b0.png');
    rightY += rightLineHeight;

    // 4. بف اللفل
    await drawTextWithIcon(ctx, buffString, bottomX, rightY, 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/26a1.png');
    rightY += rightLineHeight;

    // 5. الدروع
    await drawTextWithIcon(ctx, shieldText, bottomX, rightY, 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6e1.png');

    ctx.textAlign = 'right';
    let leftX = 50;
    let leftY = 220;
    const leftLineHeight = 28;
    ctx.fillText(rankStr, leftX, leftY);
    leftY += leftLineHeight;
    ctx.fillText(strongestRankStr, leftX, leftY);
    leftY += leftLineHeight;
    ctx.fillText(streakRankStr, leftX, leftY);
    leftY += leftLineHeight;
    ctx.fillText(moraRankStr, leftX, leftY);

    ctx.shadowBlur = 0;
    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile-general.png' });
    return attachment;
}

async function buildPvpProfile(client, member, targetUser) {
    const sql = client.sql;
    const getLevel = client.getLevel;
    const score = getLevel.get(targetUser.id, member.guild.id);
    const level = score ? score.level : 0;

    const userRace = getUserRace(member, sql);
    const weaponData = getWeaponData(sql, member);

    const background = await loadImage(path.join(__dirname, '../images/pvp.png'));
    const canvas = createCanvas(background.width, background.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

    const avatarOriginalX = 284;
    const avatarOriginalY = 29;
    const avatarOriginalSize = 99;
    const avatarNewSize = avatarOriginalSize * 1;
    const avatarXOffset = 9;
    const avatarYOffset = 3;
    const avatarFinalX = avatarOriginalX - avatarXOffset;
    const avatarFinalY = avatarOriginalY - avatarYOffset;
    const avatarCircleRadius = avatarNewSize / 2;
    const avatarCircleCenterX = avatarFinalX + avatarCircleRadius;
    const avatarCircleCenterY = avatarFinalY + avatarCircleRadius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCircleCenterX, avatarCircleCenterY, avatarCircleRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png' }));
    ctx.drawImage(avatar, avatarFinalX, avatarFinalY, avatarNewSize, avatarNewSize);
    ctx.restore();

    ctx.fillStyle = '#FFAA40';
    ctx.shadowColor = '#FFAA40';
    ctx.shadowBlur = 4;

    // 🌟 حذفنا bold 🌟
    ctx.font = `30px "${FONT_MAIN}"`; 
    ctx.textAlign = 'left';
    ctx.fillText(level, 40, 150);

    ctx.textAlign = 'right';

    if (!userRace || !weaponData) {
        ctx.shadowBlur = 0;
        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile-pvp.png' });
        return attachment;
    }

    const allStrongest = sql.prepare("SELECT userID, raceName, weaponLevel FROM user_weapons WHERE guildID = ? AND weaponLevel > 0").all(member.guild.id)
        .map(w => {
            const config = weaponsConfig.find(c => c.race === w.raceName);
            const damage = config ? config.base_damage + (config.damage_increment * (w.weaponLevel - 1)) : 0;
            return { userID: w.userID, damage: damage };
        })
        .sort((a, b) => b.damage - a.damage);
    const strongestRank = allStrongest.findIndex(s => s.userID === targetUser.id) + 1;
    const strongestRankStr = strongestRank > 0 ? `${strongestRank}` : "0";
    const maxHp = BASE_HP + (level * HP_PER_LEVEL);
    const arabicRaceName = RACE_TRANSLATIONS.get(userRace.raceName) || userRace.raceName;

    ctx.textAlign = 'right';
    let rightX = 290;
    let rightY = 165;
    const rightLineHeight = 34;

    ctx.font = `20px "${FONT_MAIN}"`; 

    ctx.fillText(arabicRaceName, rightX, rightY);
    rightY += rightLineHeight;

    ctx.fillText(`${maxHp} HP`, rightX, rightY);
    rightY += rightLineHeight;

    ctx.fillText(strongestRankStr, rightX, rightY);

    ctx.textAlign = 'right';
    let leftX = 110;
    let leftY = 243;
    const leftLineHeight = 35;

    ctx.fillText(weaponData.name, leftX, leftY);
    leftY += leftLineHeight;

    ctx.fillText(`${weaponData.currentDamage} DMG`, leftX, leftY);
    leftY += leftLineHeight;

    ctx.fillText(`${weaponData.currentLevel}/${weaponData.max_level}`, leftX, leftY);

    ctx.shadowBlur = 0;
    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile-pvp.png' });
    return attachment;
}

function createButtons(activeProfile) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('profile_general')
            .setEmoji('💎')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(activeProfile === 'general'),
        new ButtonBuilder()
            .setCustomId('profile_pvp')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(activeProfile === 'pvp')
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('بروفايل')
        .setDescription('يعرض معلومات العضو ومستوى البفات.')
        .addUserOption(option =>
            option.setName('المستخدم')
            .setDescription('المستخدم الذي تريد عرض بروفايله')
            .setRequired(false)),

    name: 'profile',
    aliases: ['p', 'بروفايل'],
    description: 'يعرض معلومات العضو ومستوى البفات',

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, authorUser;
        let targetMember; 

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            authorUser = interaction.user; 
            targetMember = interaction.options.getMember('المستخدم') || interaction.member;
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            authorUser = message.author; 
            targetMember = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.channel.send(payload);
            }
        };

        try {
            const sql = client.sql;
            const targetUser = targetMember.user; 

            let settings;
            try {
                settings = sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?").get(guild.id);
            } catch (e) { settings = null; }

            const isCasinoChannel = settings && settings.casinoChannelID === interactionOrMessage.channel.id;
            let currentProfile = isCasinoChannel ? 'pvp' : 'general';

            let messagePayload = {};
            if (currentProfile === 'pvp') {
                const pvpCard = await buildPvpProfile(client, targetMember, targetUser);
                messagePayload = { files: [pvpCard] };
            } else {
                const generalCard = await buildGeneralProfile(client, targetMember, targetUser);
                messagePayload = { files: [generalCard] };
            }

            const row = createButtons(currentProfile);
            const profileMessage = await reply({ ...messagePayload, components: [row] });

            const filter = (i) => i.user.id === authorUser.id && i.customId.startsWith('profile_');
            const collector = profileMessage.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async (i) => {
                await i.deferUpdate();

                let newPayload = {};
                if (i.customId === 'profile_general') {
                    currentProfile = 'general';
                    const generalCard = await buildGeneralProfile(client, targetMember, targetUser);
                    newPayload = { files: [generalCard], embeds: [] };
                } else {
                    currentProfile = 'pvp';
                    const pvpCard = await buildPvpProfile(client, targetMember, targetUser);
                    newPayload = { files: [pvpCard], embeds: [] };
                }

                const newRow = createButtons(currentProfile);
                await profileMessage.edit({ ...newPayload, components: [newRow] });
            });

            collector.on('end', () => {
                const disabledRow = createButtons(currentProfile);
                disabledRow.components.forEach(btn => btn.setDisabled(true));
                profileMessage.edit({ components: [disabledRow] }).catch(() => { });
            });

        } catch (error) {
            console.error("خطأ في أمر البروفايل:", error);

            if (isSlash) {
                await interaction.editReply({ content: "حدث خطأ أثناء جلب البروفايل.", ephemeral: true });
            } else {
                message.reply("حدث خطأ أثناء جلب البروفايل.");
            }
        }
    }
};
