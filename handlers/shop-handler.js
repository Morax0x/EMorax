const { EmbedBuilder, Colors, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require("discord.js");
const { sendLevelUpMessage } = require('./handler-utils.js');
const shopItems = require('../json/shop-items.json');
const farmAnimals = require('../json/farm-animals.json');
const weaponsConfig = require('../json/weapons-config.json');
const skillsConfig = require('../json/skills-config.json');
const path = require('path');

// استيراد ملف الصيد الشامل
const rootDir = process.cwd();
const { rods: rodsConfig, boats: boatsConfig, baits: baitsConfig } = require(path.join(rootDir, 'json', 'fishing-config.json'));

const EMOJI_MORA = '<:mora:1435647151349698621>';
// ( 🌟 تعريف OWNER_ID هنا في النطاق العام ليراه الملف بالكامل 🌟 )
const OWNER_ID = "1145327691772481577"; 
const XP_EXCHANGE_RATE = 3;
const BANNER_URL = 'https://i.postimg.cc/NMkWVyLV/line.png';

const THUMBNAILS = new Map([
    ['upgrade_weapon', 'https://i.postimg.cc/CMXxsXT1/tsmym-bdwn-ʿnwan-7.png'],
    ['upgrade_skill', 'https://i.postimg.cc/CMkxJJF4/tsmym-bdwn-ʿnwan-8.png'],
    ['upgrade_rod', 'https://i.postimg.cc/Wz0g0Zg0/fishing.png'], 
    ['upgrade_boat', 'https://i.postimg.cc/Wz0g0Zg0/fishing.png'], 
    ['exchange_xp', 'https://i.postimg.cc/2yKbQSd3/tsmym-bdwn-ʿnwan-6.png'],
    ['personal_guard_1d', 'https://i.postimg.cc/CMv2qp8n/tsmym-bdwn-ʿnwan-1.png'],
    ['streak_shield', 'https://i.postimg.cc/3rbLwCMj/tsmym-bdwn-ʿnwan-2.png'],
    ['streak_shield_media', 'https://i.postimg.cc/3rbLwCMj/tsmym-bdwn-ʿnwan-2.png'],
    ['xp_buff_1d_3', 'https://i.postimg.cc/TP9zNLK4/tsmym-bdwn-ʿnwan-3.png'],
    ['xp_buff_1d_7', 'https://i.postimg.cc/Gmn6cJYG/tsmym-bdwn-ʿnwan-4.png'],
    ['xp_buff_2d_10', 'https://i.postimg.cc/NFrPt5jN/tsmym-bdwn-ʿnwan-5.png'],
    ['vip_role_3d', 'https://i.postimg.cc/4drRpC7d/2.webp'],
    ['discord_effect_5', 'https://i.postimg.cc/50QZ4PPL/1.webp'],
    ['discord_effect_10', 'https://i.postimg.cc/tJHmX9nh/3.webp'],
    ['nitro_basic', 'https://i.postimg.cc/Qxmn3G8K/5.webp'],
    ['nitro_gaming', 'https://i.postimg.cc/kXJfw1Q4/6.webp'],
    ['change_race', 'https://i.postimg.cc/rs4mmjvs/tsmym-bdwn-ʿnwan-9.png']
]);

// --- دوال مساعدة ---
function normalize(str) { if (!str) return ""; return str.toString().toLowerCase().replace(/[^a-z0-9]/g, ""); }
function getGeneralSkills() { return skillsConfig.filter(s => s.id.startsWith('skill_')); }
function getRaceSkillConfig(raceName) { 
    if (!raceName) return null;
    return skillsConfig.find(s => {
        if (!s.id.startsWith('race_')) return false;
        const idName = s.id.replace('race_', '').replace('_skill', '');
        return normalize(idName) === normalize(raceName);
    }); 
}
function getUserRace(member, sql) { 
    if (!member || !member.roles) return null;
    const allRaceRoles = sql.prepare("SELECT roleID, raceName FROM race_roles WHERE guildID = ?").all(member.guild.id); 
    const userRoleIDs = member.roles.cache.map(r => r.id); 
    const userRace = allRaceRoles.find(r => userRoleIDs.includes(r.roleID)); 
    return userRace || null; 
}
function getAllUserAvailableSkills(member, sql) { const generalSkills = getGeneralSkills(); const userRace = getUserRace(member, sql); let raceSkill = null; if (userRace) { raceSkill = getRaceSkillConfig(userRace.raceName); } let allSkills = []; if (raceSkill) { allSkills.push(raceSkill); } allSkills = allSkills.concat(generalSkills); return allSkills; }
function getBuyableItems() { return shopItems.filter(it => !['upgrade_weapon', 'upgrade_skill', 'exchange_xp', 'upgrade_rod', 'fishing_gear_menu'].includes(it.id)); }

// --- Builders ---
function buildPaginatedItemEmbed(selectedItemId) {
    const buyableItems = getBuyableItems();
    const itemIndex = buyableItems.findIndex(it => it.id === selectedItemId);
    if (itemIndex === -1) return null;
    const item = buyableItems[itemIndex];
    const totalItems = buyableItems.length;
    const prevIndex = (itemIndex - 1 + totalItems) % totalItems;
    const nextIndex = (itemIndex + 1) % totalItems;
    const prevItemId = buyableItems[prevIndex].id;
    const nextItemId = buyableItems[nextIndex].id;
    const detailEmbed = new EmbedBuilder().setTitle(`${item.emoji} ${item.name}`).setDescription(item.description).addFields({ name: 'السعر', value: `**${item.price.toLocaleString()}** ${EMOJI_MORA}`, inline: true }).setColor(Colors.Greyple).setImage(BANNER_URL).setThumbnail(THUMBNAILS.get(item.id) || item.image || null).setFooter({ text: `العنصر ${itemIndex + 1} / ${totalItems}` });
    const prevButton = new ButtonBuilder().setCustomId(`shop_paginate_item_${prevItemId}`).setEmoji('<:left:1439164494759723029>').setStyle(ButtonStyle.Secondary);
    const buyButton = new ButtonBuilder().setCustomId(`buy_item_${item.id}`).setLabel('شراء').setStyle(ButtonStyle.Success).setEmoji('<:mora:1435647151349698621>');
    const nextButton = new ButtonBuilder().setCustomId(`shop_paginate_item_${nextItemId}`).setEmoji('<:right:1439164491072929915>').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(prevButton, buyButton, nextButton);
    return { embeds: [detailEmbed], components: [row] };
}

function buildSkillEmbedWithPagination(allUserSkills, pageIndex, sql, i) {
    pageIndex = parseInt(pageIndex) || 0;
    const totalSkills = allUserSkills.length;
    if (totalSkills === 0) return { content: '❌ لا توجد مهارات متاحة للعرض.', embeds: [], components: [] };
    if (pageIndex < 0) pageIndex = totalSkills - 1;
    if (pageIndex >= totalSkills) pageIndex = 0;
    const skillConfig = allUserSkills[pageIndex];
    if (!skillConfig) return { content: '❌ خطأ: لم يتم العثور على بيانات المهارة.', embeds: [], components: [] };
    const prevIndex = (pageIndex - 1 + totalSkills) % totalSkills;
    const nextIndex = (pageIndex + 1) % totalSkills;
    let userSkill = sql.prepare("SELECT * FROM user_skills WHERE userID = ? AND guildID = ? AND skillID = ?").get(i.user.id, i.guild.id, skillConfig.id);
    let currentLevel = userSkill ? userSkill.skillLevel : 0;
    const isRaceSkill = skillConfig.id.startsWith('race_');
    const embedTitle = `${skillConfig.emoji} ${skillConfig.name} ${isRaceSkill ? '(مهارة عرق)' : ''}`;
    const embed = new EmbedBuilder().setTitle(embedTitle).setDescription(skillConfig.description).setColor(isRaceSkill ? Colors.Gold : Colors.Blue).setImage(BANNER_URL).setThumbnail(THUMBNAILS.get('upgrade_skill')).setFooter({ text: `المهارة ${pageIndex + 1} / ${totalSkills}` });
    const navigationRow = new ActionRowBuilder();
    const buttonRow = new ActionRowBuilder();
    navigationRow.addComponents(new ButtonBuilder().setCustomId(`shop_skill_paginate_${prevIndex}`).setEmoji('⬅️').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`shop_skill_paginate_${nextIndex}`).setEmoji('➡️').setStyle(ButtonStyle.Secondary));
    _buildSkillEmbedFields(embed, buttonRow, skillConfig, currentLevel);
    const components = [buttonRow, navigationRow].filter(r => r.components.length > 0);
    return { embeds: [embed], components: components };
}

function _buildSkillEmbedFields(embed, buttonRow, skillConfig, currentLevel) {
    let currentEffect, nextEffect, nextLevelPrice, buttonId, buttonLabel;
    const effectType = skillConfig.stat_type.includes('%') ? '%' : (skillConfig.stat_type === 'TrueDMG' || skillConfig.stat_type === 'RecoilDMG' ? ' DMG' : '');
    if (currentLevel === 0) { currentEffect = 0; } 
    else if (skillConfig.max_level === 1) { currentEffect = skillConfig.base_value; } 
    else { currentEffect = skillConfig.base_value + (skillConfig.value_increment * (currentLevel - 1)); }
    embed.addFields({ name: "المستوى الحالي", value: `Lv. ${currentLevel}`, inline: true }, { name: "التأثير الحالي", value: `${currentEffect}${effectType}`, inline: true });
    if (currentLevel >= skillConfig.max_level) {
        embed.addFields({ name: "التطوير القادم", value: "وصلت للحد الأقصى!", inline: true });
        buttonRow.addComponents(new ButtonBuilder().setCustomId('max_level').setLabel('الحد الأقصى').setStyle(ButtonStyle.Success).setDisabled(true));
    } else {
        if (currentLevel === 0) { nextLevelPrice = skillConfig.base_price; buttonLabel = `شراء (Lv.1)`; buttonId = `buy_skill_${skillConfig.id}`; } 
        else { nextLevelPrice = skillConfig.base_price + (skillConfig.price_increment * currentLevel); buttonLabel = `تطوير (Lv.${currentLevel + 1})`; buttonId = `upgrade_skill_${skillConfig.id}`; }
        if (skillConfig.max_level === 1) { nextEffect = skillConfig.base_value; } else { nextEffect = skillConfig.base_value + (skillConfig.value_increment * currentLevel); }
        embed.addFields({ name: "المستوى القادم", value: `Lv. ${currentLevel + 1}`, inline: true }, { name: "التأثير القادم", value: `${nextEffect}${effectType}`, inline: true }, { name: "التكلفة", value: `${nextLevelPrice.toLocaleString()} ${EMOJI_MORA}`, inline: true });
        buttonRow.addComponents(new ButtonBuilder().setCustomId(buttonId).setLabel(buttonLabel).setStyle(ButtonStyle.Success).setEmoji('⬆️'));
    }
}

// --- Fishing Functions ---
async function _handleRodSelect(i, client, sql) {
    if(i.replied || i.deferred) await i.editReply("جاري التحميل..."); else await i.deferReply({ flags: MessageFlags.Ephemeral });
    let userData = sql.prepare("SELECT rodLevel FROM levels WHERE user = ? AND guild = ?").get(i.user.id, i.guild.id);
    const currentLevel = userData ? (userData.rodLevel || 1) : 1;
    const nextLevel = currentLevel + 1;
    const currentRod = rodsConfig.find(r => r.level === currentLevel) || rodsConfig[0];
    const nextRod = rodsConfig.find(r => r.level === nextLevel);
    const embed = new EmbedBuilder().setTitle(`🎣 سنارة الصيد`).setDescription(`**السنارة الحالية:** ${currentRod.name}`).setColor(Colors.Aqua).setImage(BANNER_URL).setThumbnail(THUMBNAILS.get('upgrade_rod'))
        .addFields({ name: 'المستوى الحالي', value: `Lv. ${currentLevel}`, inline: true }, { name: 'أقصى صيد', value: `${currentRod.max_fish} سمكات`, inline: true }, { name: 'الحظ', value: `+${currentRod.luck_bonus}%`, inline: true });
    const row = new ActionRowBuilder();
    if (!nextRod) {
        embed.addFields({ name: "التطوير القادم", value: "الحد الأقصى", inline: true });
        row.addComponents(new ButtonBuilder().setCustomId('max_rod').setLabel('MAX').setStyle(ButtonStyle.Secondary).setDisabled(true));
    } else {
        embed.addFields({ name: "التالي", value: nextRod.name, inline: true }, { name: "السعر", value: `${nextRod.price.toLocaleString()}`, inline: true });
        row.addComponents(new ButtonBuilder().setCustomId('upgrade_rod').setLabel('تطوير').setStyle(ButtonStyle.Success).setEmoji('⬆️'));
    }
    await i.editReply({ embeds: [embed], components: [row] });
}

async function _handleBoatSelect(i, client, sql) {
    if(i.replied || i.deferred) await i.editReply("جاري التحميل..."); else await i.deferReply({ flags: MessageFlags.Ephemeral });
    let userData = sql.prepare("SELECT boatLevel FROM levels WHERE user = ? AND guild = ?").get(i.user.id, i.guild.id);
    const currentLevel = userData ? (userData.boatLevel || 1) : 1;
    const nextLevel = currentLevel + 1;
    const currentBoat = boatsConfig.find(b => b.level === currentLevel) || boatsConfig[0];
    const nextBoat = boatsConfig.find(b => b.level === nextLevel);
    const embed = new EmbedBuilder().setTitle(`🚤 قـوارب الـصـيـد`).setDescription(`**القارب الحالي:** ${currentBoat.name}`).setColor(Colors.Blue).setImage(BANNER_URL);
    const row = new ActionRowBuilder();
    if (!nextBoat) {
        embed.addFields({ name: "التطوير", value: "الحد الأقصى", inline: true });
        row.addComponents(new ButtonBuilder().setCustomId('max_boat').setLabel('MAX').setStyle(ButtonStyle.Secondary).setDisabled(true));
    } else {
        embed.addFields({ name: "القادم", value: nextBoat.name, inline: true }, { name: "السعر", value: `${nextBoat.price.toLocaleString()}`, inline: true }, { name: "يفتح", value: nextBoat.location_id, inline: false });
        row.addComponents(new ButtonBuilder().setCustomId('upgrade_boat').setLabel('شراء').setStyle(ButtonStyle.Success).setEmoji('🚤'));
    }
    await i.editReply({ embeds: [embed], components: [row] });
}

async function _handleBaitSelect(i, client, sql) {
    if(i.replied || i.deferred) await i.editReply("جاري التحميل..."); else await i.deferReply({ flags: MessageFlags.Ephemeral });
    const baitOptions = baitsConfig.map(b => ({ label: b.name, description: `${b.description} | ${b.price} مورا`, value: `buy_bait_${b.id}`, emoji: '🪱' }));
    const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('shop_buy_bait_menu').setPlaceholder('اختر الطعم (5 حبات)...').addOptions(baitOptions));
    await i.editReply({ content: "**🛒 متجر الطعوم:**", components: [row], embeds: [] });
}

// --- Upgrade Logic ---
async function _handleRodUpgrade(i, client, sql) {
    await i.deferUpdate();
    const userId = i.user.id; let userData = client.getLevel.get(userId, i.guild.id);
    const nextLevel = (userData.rodLevel || 1) + 1; const nextRod = rodsConfig.find(r => r.level === nextLevel);
    if (!nextRod) return i.followUp({ content: '❌ الحد الأقصى.', flags: MessageFlags.Ephemeral });
    if (userData.mora < nextRod.price) return i.followUp({ content: `❌ رصيدك غير كافي.`, flags: MessageFlags.Ephemeral });
    userData.mora -= nextRod.price; userData.rodLevel = nextLevel; client.setLevel.run(userData);
    await i.followUp({ content: `🎉 مبروك! تم شراء **${nextRod.name}**!`, flags: MessageFlags.Ephemeral });
    await _handleRodSelect(i, client, sql);
}

async function _handleBoatUpgrade(i, client, sql) {
    await i.deferUpdate();
    const userId = i.user.id; let userData = client.getLevel.get(userId, i.guild.id);
    const nextLevel = (userData.boatLevel || 1) + 1; const nextBoat = boatsConfig.find(b => b.level === nextLevel);
    if (!nextBoat) return i.followUp({ content: '❌ الحد الأقصى.', flags: MessageFlags.Ephemeral });
    if (userData.mora < nextBoat.price) return i.followUp({ content: `❌ رصيدك غير كافي.`, flags: MessageFlags.Ephemeral });
    userData.mora -= nextBoat.price; userData.boatLevel = nextLevel;
    sql.prepare("UPDATE levels SET boatLevel = ?, mora = ?, currentLocation = ? WHERE user = ? AND guild = ?").run(nextLevel, userData.mora, nextBoat.location_id, userId, i.guild.id);
    await i.followUp({ content: `🎉 مبروك! تم شراء **${nextBoat.name}**!`, flags: MessageFlags.Ephemeral });
    await _handleBoatSelect(i, client, sql);
}

async function _handleBaitBuy(i, client, sql) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const baitId = i.values[0].replace('buy_bait_', '');
    const bait = baitsConfig.find(b => b.id === baitId);
    const qty = 5; const cost = bait.price * qty;
    let userData = client.getLevel.get(i.user.id, i.guild.id);
    if (userData.mora < cost) return i.editReply(`❌ رصيدك غير كافي.`);
    userData.mora -= cost; client.setLevel.run(userData);
    
    // ( 🌟 الطعوم فقط تُحفظ في الحقيبة، السنارة والقوارب لا 🌟 )
    sql.prepare("INSERT INTO user_portfolio (guildID, userID, itemID, quantity) VALUES (?, ?, ?, ?) ON CONFLICT(guildID, userID, itemID) DO UPDATE SET quantity = quantity + ?").run(i.guild.id, i.user.id, baitId, qty, qty);
    
    await i.editReply(`✅ تم شراء **${qty}x ${bait.name}** بنجاح!`);
}

// 🌟 دالة شراء السلاح (مصححة لترسل رسالة جديدة مخفية بدلاً من تعديل القائمة) 🌟
async function _handleWeaponUpgrade(i, client, sql) {
    try {
        const userId = i.user.id; 
        const guildId = i.guild.id; 
        const isBuy = i.customId.startsWith('buy_weapon_');
        
        let exactRaceName = null;
        let weaponConfig = null;

        // الحالة 1: اختيار من القائمة (إرسال رسالة مخفية جديدة)
        if (i.isStringSelectMenu() && i.values[0] === 'upgrade_weapon') {
             if (!i.replied && !i.deferred) await i.deferReply({ flags: MessageFlags.Ephemeral }); // رد جديد
             
             const userRace = getUserRace(i.member, sql);
             if (!userRace) return i.editReply({ content: "❌ ليس لديك عرق! قم باختيار عرقك أولاً." });
             
             weaponConfig = weaponsConfig.find(w => w.race.toLowerCase() === userRace.raceName.toLowerCase());
             if (!weaponConfig) return i.editReply({ content: `❌ لا يوجد سلاح متاح لعرقك (${userRace.raceName}).` });
             
             exactRaceName = weaponConfig.race;
        }
        // الحالة 2: ضغط زر الشراء/التطوير (تحديث الرسالة المخفية الحالية)
        else if (i.isButton()) {
             if (!i.replied && !i.deferred) await i.deferUpdate(); // تحديث نفس الرسالة
             
             const raceNameFromBtn = i.customId.replace(isBuy ? 'buy_weapon_' : 'upgrade_weapon_', ''); 
             // بحث دقيق
             weaponConfig = weaponsConfig.find(w => w.race.toLowerCase() === raceNameFromBtn.toLowerCase());
             
             // محاولة بحث مرن إذا فشل الدقيق
             if (!weaponConfig) {
                 const userRace = getUserRace(i.member, sql);
                 if (userRace) weaponConfig = weaponsConfig.find(w => w.race.toLowerCase() === userRace.raceName.toLowerCase());
             }

             if (!weaponConfig) {
                 return await i.followUp({ content: `❌ خطأ: لم يتم العثور على بيانات سلاح للعرق: ${raceNameFromBtn}`, flags: MessageFlags.Ephemeral });
             }
             exactRaceName = weaponConfig.race;
        }

        let userData = client.getLevel.get(userId, guildId); 
        if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };
        
        let userWeapon = sql.prepare("SELECT * FROM user_weapons WHERE userID = ? AND guildID = ? AND raceName = ?").get(userId, guildId, exactRaceName);
        let currentLevel = userWeapon ? userWeapon.weaponLevel : 0;

        // منطق الشراء (فقط عند ضغط الزر)
        if (i.isButton()) {
            if (currentLevel >= weaponConfig.max_level) {
                 return await i.followUp({ content: '❌ لقد وصلت للحد الأقصى للتطوير بالفعل!', flags: MessageFlags.Ephemeral });
            }
            
            let price = (currentLevel === 0) ? weaponConfig.base_price : weaponConfig.base_price + (weaponConfig.price_increment * currentLevel);
            
            if (userData.mora < price) {
                return await i.followUp({ content: `❌ رصيدك غير كافي! تحتاج إلى **${price.toLocaleString()}** ${EMOJI_MORA}`, flags: MessageFlags.Ephemeral });
            }
            
            userData.mora -= price; 
            userData.shop_purchases = (userData.shop_purchases || 0) + 1; 
            client.setLevel.run(userData);
            
            const newLevel = currentLevel + 1;
            if (isBuy) sql.prepare("INSERT INTO user_weapons (userID, guildID, raceName, weaponLevel) VALUES (?, ?, ?, ?)").run(userId, guildId, exactRaceName, newLevel);
            else sql.prepare("UPDATE user_weapons SET weaponLevel = ? WHERE id = ?").run(newLevel, userWeapon.id);
            
            currentLevel = newLevel;
            await i.followUp({ content: `🎉 تم التطوير بنجاح!`, flags: MessageFlags.Ephemeral });
        }

        // بناء وعرض الإيمبد
        const newDamage = weaponConfig.base_damage + (weaponConfig.damage_increment * (currentLevel - (currentLevel > 0 ? 1 : 0)));
        const embed = new EmbedBuilder().setTitle(`${weaponConfig.emoji} سلاح العرق: ${weaponConfig.name}`).setColor(Colors.Blue).setImage(BANNER_URL).setThumbnail(THUMBNAILS.get('upgrade_weapon')).addFields({ name: "العرق", value: exactRaceName, inline: true }, { name: "المستوى", value: `Lv. ${currentLevel}`, inline: true }, { name: "الضرر", value: `${newDamage} DMG`, inline: true });
        
        const row = new ActionRowBuilder();
        if (currentLevel >= weaponConfig.max_level) { 
            embed.addFields({ name: "التطوير", value: "وصلت للحد الأقصى!", inline: true }); 
            row.addComponents(new ButtonBuilder().setCustomId('max_level').setLabel('الحد الأقصى').setStyle(ButtonStyle.Success).setDisabled(true)); 
        } else { 
            const nextLevelPrice = weaponConfig.base_price + (weaponConfig.price_increment * currentLevel); 
            const nextDamage = newDamage + weaponConfig.damage_increment; 
            const buttonId = currentLevel === 0 ? `buy_weapon_${exactRaceName}` : `upgrade_weapon_${exactRaceName}`; 
            const buttonLabel = currentLevel === 0 ? `شراء (Lv.1)` : `تطوير (Lv.${currentLevel + 1})`; 
            embed.addFields({ name: "المستوى القادم", value: `Lv. ${currentLevel + 1}`, inline: true }, { name: "التأثير القادم", value: `${nextDamage} DMG`, inline: true }, { name: "تكلفة التطوير", value: `${nextLevelPrice.toLocaleString()} ${EMOJI_MORA}`, inline: true }); 
            row.addComponents(new ButtonBuilder().setCustomId(buttonId).setLabel(buttonLabel).setStyle(ButtonStyle.Success).setEmoji('⬆️')); 
        }
        
        await i.editReply({ embeds: [embed], components: [row] });
        
    } catch (error) { console.error("خطأ في زر تطوير السلاح:", error); if (i.replied || i.deferred) await i.followUp({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }); }
}

async function _handleSkillUpgrade(i, client, sql) {
    try {
        await i.deferUpdate();
        const userId = i.user.id; const guildId = i.guild.id; const isBuy = i.customId.startsWith('buy_skill_');
        const skillId = i.customId.replace(isBuy ? 'buy_skill_' : 'upgrade_skill_', ''); const skillConfig = skillsConfig.find(s => s.id === skillId);
        if (!skillConfig) return await i.followUp({ content: '❌ خطأ: لم يتم العثور على بيانات هذه المهارة.', flags: MessageFlags.Ephemeral });
        let userData = client.getLevel.get(userId, guildId); if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };
        let userSkill = sql.prepare("SELECT * FROM user_skills WHERE userID = ? AND guildID = ? AND skillID = ?").get(userId, guildId, skillId);
        let currentLevel = userSkill ? userSkill.skillLevel : 0; let price = 0;
        if (currentLevel >= skillConfig.max_level) return await i.followUp({ content: '❌ لقد وصلت للحد الأقصى للتطوير بالفعل!', flags: MessageFlags.Ephemeral });
        price = (currentLevel === 0) ? skillConfig.base_price : skillConfig.base_price + (skillConfig.price_increment * currentLevel);
        if (userData.mora < price) return await i.followUp({ content: `❌ رصيدك غير كافي!`, flags: MessageFlags.Ephemeral });
        userData.mora -= price; userData.shop_purchases = (userData.shop_purchases || 0) + 1; client.setLevel.run(userData);
        const newLevel = currentLevel + 1;
        if (isBuy) sql.prepare("INSERT INTO user_skills (userID, guildID, skillID, skillLevel) VALUES (?, ?, ?, ?)").run(userId, guildId, skillId, newLevel);
        else sql.prepare("UPDATE user_skills SET skillLevel = ? WHERE id = ?").run(newLevel, userSkill.id);
        const allUserSkills = getAllUserAvailableSkills(i.member, sql); const currentPageIndex = allUserSkills.findIndex(s => s.id === skillId);
        const updatedEmbed = buildSkillEmbedWithPagination(allUserSkills, currentPageIndex, sql, i);
        await i.editReply(updatedEmbed); await i.followUp({ content: `🎉 تم التطوير بنجاح!`, flags: MessageFlags.Ephemeral });
    } catch (error) { console.error("خطأ في زر تطوير المهارة:", error); if (i.replied || i.deferred) await i.followUp({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }); }
}

async function _handleShopButton(i, client, sql) {
    try {
        const userId = i.user.id; const guildId = i.guild.id; const boughtItemId = i.customId.replace('buy_item_', ''); const item = shopItems.find(it => it.id === boughtItemId);
        if (!item) return await i.reply({ content: '❌ هذا العنصر غير موجود!', flags: MessageFlags.Ephemeral });
        let userData = client.getLevel.get(userId, guildId); if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };
        
        // ( 🌟 شرط اللفل 30 🌟 )
        const RESTRICTED_ITEMS = ['nitro_basic', 'nitro_gaming', 'discord_effect_5', 'discord_effect_10'];
        if (RESTRICTED_ITEMS.includes(item.id)) {
             if (userData.level < 30) return await i.reply({ content: `❌ يجب أن يكون مستواك 30+ لشراء هذا العنصر!`, flags: MessageFlags.Ephemeral });
             const userLoan = sql.prepare("SELECT 1 FROM user_loans WHERE userID = ? AND guildID = ? AND remainingAmount > 0").get(userId, guildId);
             if (userLoan) return await i.reply({ content: `عـليـك قـرض قـم بـسداده اولا`, flags: MessageFlags.Ephemeral });
        }

        if (userData.mora < item.price) return await i.reply({ content: `❌ رصيدك غير كافي!`, flags: MessageFlags.Ephemeral });
        if (item.id.startsWith('xp_buff_')) {
            const getActiveBuff = sql.prepare("SELECT * FROM user_buffs WHERE userID = ? AND guildID = ? AND buffType = 'xp' AND expiresAt > ?");
            const activeBuff = getActiveBuff.get(userId, guildId, Date.now());
            if (activeBuff) {
                const replaceButton = new ButtonBuilder().setCustomId(`replace_buff_${item.id}`).setLabel("إلغاء القديم وشراء الجديد").setStyle(ButtonStyle.Danger);
                const cancelButton = new ButtonBuilder().setCustomId('cancel_purchase').setLabel("إلغاء").setStyle(ButtonStyle.Secondary);
                const row = new ActionRowBuilder().addComponents(replaceButton, cancelButton);
                return await i.reply({ content: `⚠️ لديك معزز خبرة فعال بالفعل!`, components: [row], embeds: [], flags: MessageFlags.Ephemeral });
            }
        }
        
        userData.mora -= item.price;
        let successMessage = `✅ تم شراء **${item.name}** بنجاح!`;
        
        // ( 🌟 هنا التحديث: مدة البفات ونسبها الجديدة 🌟 )
        switch (item.id) {
            case 'personal_guard_1d': userData.hasGuard = (userData.hasGuard || 0) + 3; userData.guardExpires = 0; successMessage = `✅ تم توقيع عقد الحراسة!`; break;
            case 'streak_shield': {
                const setStreak = sql.prepare("INSERT OR REPLACE INTO streaks (id, guildID, userID, streakCount, lastMessageTimestamp, hasGracePeriod, hasItemShield, nicknameActive, hasReceivedFreeShield, separator, dmNotify, highestStreak) VALUES (@id, @guildID, @userID, @streakCount, @lastMessageTimestamp, @hasGracePeriod, @hasItemShield, @nicknameActive, @hasReceivedFreeShield, @separator, @dmNotify, @highestStreak);");
                const existingStreak = sql.prepare("SELECT * FROM streaks WHERE userID = ? AND guildID = ?").get(userId, guildId);
                if (existingStreak && existingStreak.hasItemShield === 1) { userData.mora += item.price; return await i.reply({ content: '🔥 لديك درع ستريك جاهز بالفعل!', flags: MessageFlags.Ephemeral }); }
                const fullStreakData = { id: existingStreak?.id || `${guildId}-${userId}`, guildID: guildId, userID: userId, streakCount: existingStreak?.streakCount || 0, lastMessageTimestamp: existingStreak?.lastMessageTimestamp || 0, hasGracePeriod: existingStreak?.hasGracePeriod || 0, hasItemShield: 1, nicknameActive: existingStreak?.nicknameActive ?? 1, hasReceivedFreeShield: existingStreak?.hasReceivedFreeShield || 0, separator: existingStreak?.separator || '|', dmNotify: existingStreak?.dmNotify ?? 1, highestStreak: existingStreak?.highestStreak || 0 };
                setStreak.run(fullStreakData); break;
            }
            case 'streak_shield_media': {
                const setMediaStreak = sql.prepare("INSERT OR REPLACE INTO media_streaks (id, guildID, userID, streakCount, lastMediaTimestamp, hasGracePeriod, hasItemShield, hasReceivedFreeShield, dmNotify, highestStreak) VALUES (@id, @guildID, @userID, @streakCount, @lastMediaTimestamp, @hasGracePeriod, @hasItemShield, @hasReceivedFreeShield, @dmNotify, @highestStreak);");
                const existingMediaStreak = sql.prepare("SELECT * FROM media_streaks WHERE userID = ? AND guildID = ?").get(userId, guildId);
                if (existingMediaStreak && existingMediaStreak.hasItemShield === 1) { userData.mora += item.price; return await i.reply({ content: '📸 لديك درع ستريك ميديا جاهز بالفعل!', flags: MessageFlags.Ephemeral }); }
                const fullMediaStreakData = { id: existingMediaStreak?.id || `${guildId}-${userId}`, guildID: guildId, userID: userId, streakCount: existingMediaStreak?.streakCount || 0, lastMediaTimestamp: existingMediaStreak?.lastMediaTimestamp || 0, hasGracePeriod: existingMediaStreak?.hasGracePeriod || 0, hasItemShield: 1, hasReceivedFreeShield: existingMediaStreak?.hasReceivedFreeShield || 0, dmNotify: existingMediaStreak?.dmNotify ?? 1, highestStreak: existingMediaStreak?.highestStreak || 0 };
                setMediaStreak.run(fullMediaStreakData); break;
            }
            
            // 🌟 تعديل البفات (النسبة والمدة) 🌟
            case 'xp_buff_1d_3': // صغير
                sql.prepare("INSERT INTO user_buffs (userID, guildID, buffType, multiplier, expiresAt, buffPercent) VALUES (?, ?, ?, ?, ?, ?)").run(userId, guildId, 'xp', 0.45, Date.now() + (24 * 60 * 60 * 1000), 45); 
                break;
            case 'xp_buff_1d_7': // متوسط
                sql.prepare("INSERT INTO user_buffs (userID, guildID, buffType, multiplier, expiresAt, buffPercent) VALUES (?, ?, ?, ?, ?, ?)").run(userId, guildId, 'xp', 0.70, Date.now() + (48 * 60 * 60 * 1000), 70); 
                break;
            case 'xp_buff_2d_10': // كبير
                sql.prepare("INSERT INTO user_buffs (userID, guildID, buffType, multiplier, expiresAt, buffPercent) VALUES (?, ?, ?, ?, ?, ?)").run(userId, guildId, 'xp', 0.90, Date.now() + (72 * 60 * 60 * 1000), 90); 
                break;

            case 'vip_role_3d':
                const settings = sql.prepare("SELECT vipRoleID FROM settings WHERE guild = ?").get(guildId);
                const VIP_ROLE_ID = settings ? settings.vipRoleID : null;
                if (!VIP_ROLE_ID) { userData.mora += item.price; return await i.reply({ content: '❌ لم يقم أي إداري بتحديد رتبة الـ VIP.', flags: MessageFlags.Ephemeral }); }
                const member = await i.guild.members.fetch(userId);
                await member.roles.add(VIP_ROLE_ID);
                const expiresAt = Date.now() + (3 * 24 * 60 * 60 * 1000);
                sql.prepare("INSERT OR REPLACE INTO temporary_roles (userID, guildID, roleID, expiresAt) VALUES (?, ?, ?, ?)").run(userId, guildId, VIP_ROLE_ID, expiresAt);
                successMessage = `✅ تم شراء **${item.name}**!`; break;
            case 'discord_effect_5': case 'discord_effect_10': case 'nitro_basic': case 'nitro_gaming':
                const owner = await client.users.fetch(OWNER_ID);
                if (owner) { owner.send(`🔔 تنبيه شراء!\n\nالعضو: ${i.user.tag} (${i.user.id})\nاشترى: **${item.name}**\nالمبلغ: ${item.price.toLocaleString()} ${EMOJI_MORA}`).catch(console.error); }
                successMessage = `✅ تمت عملية الشراء! فضلاً، قم بفتح "مجلس خاص" (تكت) لاستلام طلبك.`; break;
            case 'change_race': {
                let removedRoleName = "لا يوجد";
                try {
                    const allRaceRoles = sql.prepare("SELECT roleID, raceName FROM race_roles WHERE guildID = ?").all(i.guild.id);
                    const raceRoleIDs = allRaceRoles.map(r => r.roleID);
                    const userRaceRole = i.member.roles.cache.find(r => raceRoleIDs.includes(r.id));
                    if (userRaceRole) { await i.member.roles.remove(userRaceRole); removedRoleName = userRaceRole.name; }
                } catch (err) { console.error("[Shop Change Race] Failed to remove race role:", err); }
                const durationMs = (item.duration || 7) * 24 * 60 * 60 * 1000; const expiresAt = Date.now() + durationMs; const debuffPercent = -5; const debuffMultiplier = -0.05; 
                try { sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(i.guild.id, i.user.id, debuffPercent, expiresAt, 'xp', debuffMultiplier);
                      sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(i.guild.id, i.user.id, debuffPercent, expiresAt, 'mora', debuffMultiplier);
                } catch (dbErr) { console.error("[Shop Change Race] Failed to insert debuffs:", dbErr); }
                successMessage = `🧬 **تم تغيير العرق!**\nتمت إزالة رتبة: **${removedRoleName}**.\n**تحذير:** تخفيض **${debuffPercent}%** (XP/Mora) لمدة 7 أيام.`; break;
            }
        }
        userData.shop_purchases = (userData.shop_purchases || 0) + 1;
        client.setLevel.run(userData);
        await i.reply({ content: `${successMessage}\nرصيدك المتبقي: **${userData.mora.toLocaleString()}** ${EMOJI_MORA}`, components: [], embeds: [], flags: MessageFlags.Ephemeral });
    } catch (error) { console.error("خطأ في زر المتجر:", error); if (i.replied || i.deferred) await i.followUp({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }); else await i.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }); }
}

async function _handleReplaceBuffButton(i, client, sql) {
    try {
        await i.deferUpdate();
        const userId = i.user.id; const guildId = i.guild.id; const newItemId = i.customId.replace('replace_buff_', '');
        const item = shopItems.find(it => it.id === newItemId);
        if (!item) return await i.editReply({ content: '❌ هذا العنصر غير موجود!', components: [], embeds: [] });
        let userData = client.getLevel.get(userId, guildId);
        if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };
        if (userData.mora < item.price) return await i.editReply({ content: `❌ رصيدك غير كافي! تحتاج إلى **${item.price.toLocaleString()}** ${EMOJI_MORA}`, components: [], embeds: [] });
        userData.mora -= item.price;
        sql.prepare("DELETE FROM user_buffs WHERE userID = ? AND guildID = ? AND buffType = 'xp'").run(userId, guildId);
        
        let expiresAt, multiplier, buffPercent;
        
        // 🌟 تعديل البفات (الاستبدال) 🌟
        switch (item.id) {
            case 'xp_buff_1d_3': multiplier = 0.45; buffPercent = 45; expiresAt = Date.now() + (24 * 60 * 60 * 1000); break;
            case 'xp_buff_1d_7': multiplier = 0.70; buffPercent = 70; expiresAt = Date.now() + (48 * 60 * 60 * 1000); break;
            case 'xp_buff_2d_10': multiplier = 0.90; buffPercent = 90; expiresAt = Date.now() + (72 * 60 * 60 * 1000); break;
        }

        sql.prepare("INSERT INTO user_buffs (userID, guildID, buffType, multiplier, expiresAt, buffPercent) VALUES (?, ?, ?, ?, ?, ?)").run(userId, guildId, 'xp', multiplier, expiresAt, buffPercent);
        userData.shop_purchases = (userData.shop_purchases || 0) + 1;
        client.setLevel.run(userData);
        await i.editReply({ content: `✅ تم استبدال المعزز وشراء **${item.name}** بنجاح!\nرصيدك المتبقي: **${userData.mora.toLocaleString()}** ${EMOJI_MORA}`, components: [], embeds: [] });
    } catch (error) { console.error("خطأ في زر استبدال المعزز:", error); if (i.replied || i.deferred) await i.followUp({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }); }
}

async function handleShopModal(i, client, sql) {
    if (i.customId === 'exchange_xp_modal') {
        await _handleXpExchangeModal(i, client, sql);
        return true;
    }
    const isBuyMarket = i.customId.startsWith('buy_modal_');
    const isSellMarket = i.customId.startsWith('sell_modal_');
    const isBuyFarm = i.customId.startsWith('buy_animal_');
    const isSellFarm = i.customId.startsWith('sell_animal_');

    if (isBuyMarket || isSellMarket || isBuyFarm || isSellFarm) {
        await _handleBuySellModal(i, client, sql, { isBuyMarket, isSellMarket, isBuyFarm, isSellFarm });
        return true;
    }
    return false;
}

// 🌟 دالة الشراء والبيع (علنية: ephemeral = false) 🌟
async function _handleBuySellModal(i, client, sql, types) {
    const { isBuyMarket, isSellMarket, isBuyFarm, isSellFarm } = types;
    // ✅ الرد علني (ظاهر للكل)
    await i.deferReply({ ephemeral: false });
    try {
        const quantityString = i.fields.getTextInputValue('quantity_input');
        const quantity = parseInt(quantityString.trim().replace(/,/g, ''));
        if (isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) return await i.editReply({ content: '❌ كمية غير صالحة.' });
        
        let userData = client.getLevel.get(i.user.id, i.guild.id);
        if (!userData) userData = { ...client.defaultData, user: i.user.id, guild: i.guild.id };
        let userMora = userData.mora || 0;
        
        // Farm Logic
        if (isBuyFarm || isSellFarm) {
             const animalId = i.customId.replace(isBuyFarm ? 'buy_animal_' : 'sell_animal_', '');
             const animal = farmAnimals.find(a => a.id === animalId);
             if (!animal) return await i.editReply({ content: '❌ حيوان غير موجود.' });
             
             if(isBuyFarm) {
                 const totalCost = Math.floor(animal.price * quantity);
                 if (userMora < totalCost) return await i.editReply({ content: `❌ رصيدك غير كافي! تحتاج: **${totalCost.toLocaleString()}** ${EMOJI_MORA}` });
                 userData.mora -= totalCost;
                 const now = Date.now();
                 for (let j = 0; j < quantity; j++) sql.prepare("INSERT INTO user_farm (guildID, userID, animalID, purchaseTimestamp, lastCollected) VALUES (?, ?, ?, ?, ?)").run(i.guild.id, i.user.id, animal.id, now, now);
                 userData.shop_purchases = (userData.shop_purchases || 0) + 1;
                 client.setLevel.run(userData);
                 const embed = new EmbedBuilder().setTitle('✅ تم الشراء').setColor(Colors.Green).setDescription(`📦 **${quantity}** × ${animal.name}\n💵 التكلفة: **${totalCost.toLocaleString()}** ${EMOJI_MORA}`).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() });
                 return await i.editReply({ embeds: [embed] });
             } else {
                 const farmCount = sql.prepare("SELECT COUNT(*) as count FROM user_farm WHERE userID = ? AND guildID = ? AND animalID = ?").get(i.user.id, i.guild.id, animal.id).count;
                 if (farmCount < quantity) return await i.editReply({ content: `❌ لا تملك هذه الكمية.` });
                 const toDelete = sql.prepare("SELECT id FROM user_farm WHERE userID = ? AND guildID = ? AND animalID = ? LIMIT ?").all(i.user.id, i.guild.id, animal.id, quantity);
                 toDelete.forEach(d => sql.prepare("DELETE FROM user_farm WHERE id = ?").run(d.id));
                 const totalGain = Math.floor(animal.price * 0.70 * quantity);
                 userData.mora += totalGain;
                 client.setLevel.run(userData);
                 const embed = new EmbedBuilder().setTitle('✅ تم البيع').setColor(Colors.Green).setDescription(`📦 **${quantity}** × ${animal.name}\n💵 الربح: **${totalGain.toLocaleString()}** ${EMOJI_MORA}`).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() });
                 return await i.editReply({ embeds: [embed] });
             }
        }
        
        // Market Logic
        const assetId = i.customId.replace(isBuyMarket ? 'buy_modal_' : 'sell_modal_', '');
        const item = sql.prepare("SELECT * FROM market_items WHERE id = ?").get(assetId);
        if (!item) return await i.editReply({ content: '❌ الأصل غير موجود.' });
        
        const getPortfolio = sql.prepare("SELECT * FROM user_portfolio WHERE userID = ? AND guildID = ? AND itemID = ?");
        
        if (isBuyMarket) {
             const totalCost = Math.floor(item.currentPrice * quantity);
             if (userMora < totalCost) return await i.editReply({ content: `❌ رصيدك غير كافي!` });
             userData.mora -= totalCost;
             userData.shop_purchases = (userData.shop_purchases || 0) + 1;
             client.setLevel.run(userData);
             
             let pfItem = getPortfolio.get(i.user.id, i.guild.id, item.id);
             if (pfItem) sql.prepare("UPDATE user_portfolio SET quantity = quantity + ? WHERE id = ?").run(quantity, pfItem.id);
             else sql.prepare("INSERT INTO user_portfolio (guildID, userID, itemID, quantity) VALUES (?, ?, ?, ?)").run(i.guild.id, i.user.id, item.id, quantity);
             
             const embed = new EmbedBuilder().setTitle('✅ تم الشراء').setColor(Colors.Green).setDescription(`📦 **${quantity}** × ${item.name}\n💵 التكلفة: **${totalCost.toLocaleString()}** ${EMOJI_MORA}`).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() });
             await i.editReply({ embeds: [embed] });
        } else {
             let pfItem = getPortfolio.get(i.user.id, i.guild.id, item.id);
             const userQty = pfItem ? pfItem.quantity : 0;
             if (userQty < quantity) return await i.editReply({ content: `❌ لا تملك الكمية.` });
             
             const totalGain = Math.floor(item.currentPrice * quantity);
             userData.mora += totalGain;
             client.setLevel.run(userData);
             
             if (userQty - quantity > 0) sql.prepare("UPDATE user_portfolio SET quantity = ? WHERE id = ?").run(userQty - quantity, pfItem.id);
             else sql.prepare("DELETE FROM user_portfolio WHERE id = ?").run(pfItem.id);
             
             const embed = new EmbedBuilder().setTitle('✅ تم البيع').setColor(Colors.Green).setDescription(`📦 **${quantity}** × ${item.name}\n💵 الربح: **${totalGain.toLocaleString()}** ${EMOJI_MORA}`).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() });
             await i.editReply({ embeds: [embed] });
        }
    } catch (error) { console.error(error); await i.editReply("❌ حدث خطأ."); }
}

async function _handleXpExchangeModal(i, client, sql) {
    try {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const userId = i.user.id; const guildId = i.guild.id;
        const userLoan = sql.prepare("SELECT 1 FROM user_loans WHERE userID = ? AND guildID = ? AND remainingAmount > 0").get(userId, guildId);
        if (userLoan) return await i.editReply({ content: `❌ عليك قرض.` });
        let userData = client.getLevel.get(userId, guildId);
        if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };
        const userMora = userData.mora || 0;
        const amountString = i.fields.getTextInputValue('xp_amount_input').trim().toLowerCase();
        let amountToBuy = 0;
        if (amountString === 'all') amountToBuy = Math.floor(userMora / XP_EXCHANGE_RATE);
        else amountToBuy = parseInt(amountString.replace(/,/g, ''));
        if (isNaN(amountToBuy) || amountToBuy <= 0) return await i.editReply({ content: '❌ رقم غير صالح.' });
        const totalCost = amountToBuy * XP_EXCHANGE_RATE;
        if (userMora < totalCost) return await i.editReply({ content: `❌ رصيدك غير كافي.` });
        userData.mora -= totalCost; userData.xp += amountToBuy; userData.totalXP += amountToBuy;
        let nextXP = 5 * (userData.level ** 2) + (50 * userData.level) + 100;
        let levelUpOccurred = false;
        while (userData.xp >= nextXP) {
             const oldLevel = userData.level; userData.level++; userData.xp -= nextXP;
             nextXP = 5 * (userData.level ** 2) + (50 * userData.level) + 100;
             levelUpOccurred = true;
             await sendLevelUpMessage(i, i.member, userData.level, oldLevel, userData, sql);
        }
        userData.shop_purchases = (userData.shop_purchases || 0) + 1;
        client.setLevel.run(userData);
        let msg = `✅ تم شراء **${amountToBuy} XP** بـ **${totalCost}** مورا.`;
        if (levelUpOccurred) msg += `\n🎉 مبروك المستوى الجديد ${userData.level}!`;
        await i.editReply({ content: msg });
    } catch (e) { console.error(e); }
}

async function handleShopSelectMenu(i, client, sql) {
    try {
        const selected = i.values[0];
        
        // Fishing Gear
        if (selected === 'fishing_gear_menu') {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder().setTitle('🎣 عـدة الـصـيـد').setDescription('اختر القسم الذي تريد تصفحه:').setColor(Colors.Aqua).setImage(BANNER_URL);
            const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('fishing_gear_sub_menu').setPlaceholder('اختر الفئة...').addOptions(
                { label: 'السنارات', value: 'gear_rods', emoji: '🎣' }, { label: 'القوارب', value: 'gear_boats', emoji: '🚤' }, { label: 'الطعوم', value: 'gear_baits', emoji: '🪱' }
            ));
            return await i.editReply({ embeds: [embed], components: [row] });
        }
        
        // Weapons & Skills
        if (selected === 'upgrade_weapon') { await _handleWeaponUpgrade(i, client, sql); return; }
        if (selected === 'upgrade_skill') {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const allUserSkills = getAllUserAvailableSkills(i.member, sql);
            if (allUserSkills.length === 0) return await i.editReply({ content: '❌ لا توجد مهارات متاحة.' });
            const skillOptions = allUserSkills.map(s => new StringSelectMenuOptionBuilder().setLabel(s.name).setDescription(s.description.substring(0,100)).setValue(s.id).setEmoji(s.emoji));
            const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('shop_skill_select_menu').setPlaceholder('اختر المهارة...').addOptions(skillOptions));
            return await i.editReply({ content: 'اختر مهارة:', components: [row] });
        }
        
        // Exchange XP
        if (selected === 'exchange_xp') {
             const btn = new ButtonBuilder().setCustomId('open_xp_modal').setLabel('بدء التبادل').setStyle(ButtonStyle.Primary).setEmoji('🪙');
             const embed = new EmbedBuilder().setTitle('تبديل الخبرة').setDescription(`السعر: ${XP_EXCHANGE_RATE} مورا = 1 XP`).setColor(Colors.Blue).setImage(BANNER_URL).setThumbnail(THUMBNAILS.get('exchange_xp'));
             return await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)], flags: MessageFlags.Ephemeral });
        }

        const item = getBuyableItems().find(it => it.id === selected);
        if (item) {
             const paginationEmbed = buildPaginatedItemEmbed(selected);
             if (paginationEmbed) return await i.reply({ ...paginationEmbed, flags: MessageFlags.Ephemeral });
        }
    } catch (e) { console.error(e); }
}

async function handleShopInteractions(i, client, sql) {
    if (i.customId.startsWith('shop_paginate_item_')) { try { await i.deferUpdate(); const id = i.customId.replace('shop_paginate_item_', ''); const embed = buildPaginatedItemEmbed(id); if (embed) await i.editReply(embed); } catch (e) {} return; }
    if (i.customId.startsWith('shop_skill_paginate_')) { try { await i.deferUpdate(); const idx = i.customId.replace('shop_skill_paginate_', ''); const skills = getAllUserAvailableSkills(i.member, sql); const embed = buildSkillEmbedWithPagination(skills, idx, sql, i); if (embed) await i.editReply(embed); } catch (e) {} return; }

    if (i.isStringSelectMenu() && i.customId === 'fishing_gear_sub_menu') {
        const val = i.values[0];
        if (val === 'gear_rods') await _handleRodSelect(i, client, sql);
        else if (val === 'gear_boats') await _handleBoatSelect(i, client, sql);
        else if (val === 'gear_baits') await _handleBaitSelect(i, client, sql);
        return;
    }

    if (i.customId === 'upgrade_rod') await _handleRodUpgrade(i, client, sql);
    else if (i.customId === 'upgrade_boat') await _handleBoatUpgrade(i, client, sql);
    else if (i.isStringSelectMenu() && i.customId === 'shop_buy_bait_menu') await _handleBaitBuy(i, client, sql);
    
    else if (i.customId.startsWith('buy_item_')) await _handleShopButton(i, client, sql);
    else if (i.customId.startsWith('replace_buff_')) await _handleReplaceBuffButton(i, client, sql);
    else if (i.customId.startsWith('buy_weapon_') || i.customId.startsWith('upgrade_weapon_')) await _handleWeaponUpgrade(i, client, sql);
    else if (i.customId.startsWith('buy_skill_') || i.customId.startsWith('upgrade_skill_')) await _handleSkillUpgrade(i, client, sql);
    else if (i.customId === 'cancel_purchase') { await i.deferUpdate(); await i.editReply({ content: 'تم الإلغاء.', components: [], embeds: [] }); }
    else if (i.customId === 'open_xp_modal') { 
        const xpModal = new ModalBuilder().setCustomId('exchange_xp_modal').setTitle('شراء خبرة');
        xpModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_amount_input').setLabel('الكمية').setStyle(TextInputStyle.Short).setRequired(true)));
        await i.showModal(xpModal);
    }
    // (فتح مودال الشراء/البيع للمزرعة والسوق)
    else if (i.customId.startsWith('buy_market_') || i.customId.startsWith('sell_market_') || i.customId.startsWith('buy_animal_') || i.customId.startsWith('sell_animal_')) {
        const action = i.customId.split('_')[0]; // buy or sell
        const modalId = action === 'buy' ? (i.customId.includes('market') ? 'buy_modal_' : 'buy_animal_') : (i.customId.includes('market') ? 'sell_modal_' : 'sell_animal_');
        const suffix = i.customId.split('_').slice(2).join('_'); // item id
        
        const modal = new ModalBuilder().setCustomId(modalId + suffix).setTitle(action === 'buy' ? 'شراء' : 'بيع');
        const input = new TextInputBuilder().setCustomId('quantity_input').setLabel('الكمية').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await i.showModal(modal);
    }
}

async function handleSkillSelectMenu(i, client, sql) {
    try {
        await i.deferUpdate(); 
        const skillId = i.values[0];
        const allUserSkills = getAllUserAvailableSkills(i.member, sql);
        const skillIndex = allUserSkills.findIndex(s => s.id === skillId);
        if (skillIndex === -1) return await i.editReply({ content: "خطأ: المهارة غير موجودة." });
        const paginationEmbed = buildSkillEmbedWithPagination(allUserSkills, skillIndex, sql, i);
        await i.editReply({ content: null, ...paginationEmbed });
    } catch (error) { console.error(error); }
}

module.exports = {
    handleShopModal,
    handleShopSelectMenu,
    handleShopInteractions,
    handleSkillSelectMenu
};
