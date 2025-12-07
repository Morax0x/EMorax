const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Colors, MessageFlags } = require("discord.js");
const { getWeaponData, getUserRace, getAllSkillData } = require('./pvp-core.js');

// 🛠️ الآيدي الخاص بك (بدون كولداون)
const OWNER_ID = '1145327691772481577'; 

const HIT_COOLDOWN = 2 * 60 * 60 * 1000; 
const EMOJI_MORA = '<:mora:1435647151349698621>'; 

// رسم الشريط (نفس الطول)
function createProgressBar(current, max, length = 20) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '🟥'.repeat(filled) + '⬛'.repeat(empty);
}

// تنسيق السجل
function updateBossLog(boss, username, damage, type = '⚔️') {
    let logs = [];
    try { logs = JSON.parse(boss.lastLog || '[]'); } catch (e) {}
    logs.unshift(`╰ **${username}**: ${type} \`-${damage.toLocaleString()}\``);
    if (logs.length > 4) logs = logs.slice(0, 4); 
    return JSON.stringify(logs);
}

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    
    const { customId, guild, user, member } = interaction;
    const guildID = guild.id;
    const userID = user.id;

    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    if (!boss) return interaction.reply({ content: "❌ **الوحش مات!**", flags: [MessageFlags.Ephemeral] });

    // --- 1. زر الحالة ---
    if (customId === 'boss_status') {
        const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 5").all(guildID);
        let lbText = leaderboard.length > 0 
            ? leaderboard.map((entry, index) => `**#${index+1}** <@${entry.userID}> 💥 **${entry.totalDamage.toLocaleString()}**`).join('\n') 
            : "لا يوجد سجلات.";

        const statusEmbed = new EmbedBuilder()
            .setTitle(`📊 تقرير المعركة: ${boss.name}`)
            .setColor(Colors.Blue)
            .setThumbnail(boss.image || null)
            .setDescription(
                `✬ **الـصـحـة:** ${boss.currentHP.toLocaleString()} / ${boss.maxHP.toLocaleString()}\n` +
                `✬ **الـحـالـة:** هائج ومستعد للقتال\n\n` +
                `✬ **أبـطـال الـمـعـركـة (Top 5):**\n${lbText}`
            );
        return interaction.reply({ embeds: [statusEmbed], flags: [MessageFlags.Ephemeral] });
    }

    // --- 2. زر المهارات (يفتح القائمة) ---
    if (customId === 'boss_skill_menu') {
        const userSkills = getAllSkillData(sql, member);
        const availableSkills = Object.values(userSkills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));

        if (availableSkills.length === 0) {
            return interaction.reply({ content: "❌ **ليس لديك مهارات!**\nقم بشراء مهارات من المتجر أو احصل على عرق.", flags: [MessageFlags.Ephemeral] });
        }

        // إنشاء القائمة المنسدلة
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('boss_execute_skill')
            .setPlaceholder('✨ اختر المهارة للهجوم...')
            .addOptions(
                availableSkills.slice(0, 25).map(skill => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(skill.name)
                        .setDescription(`القوة: ${skill.effectValue}%`) // وصف بسيط
                        .setValue(skill.id)
                        .setEmoji(skill.emoji || '✨')
                )
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({ content: "**اختر المهارة:**", components: [row], flags: [MessageFlags.Ephemeral] });
    }

    // --- 3. التنفيذ (هجوم أو مهارة) ---
    let isSkill = false;
    let skillData = null;

    // استلام اختيار القائمة المنسدلة
    if (customId === 'boss_execute_skill') {
        isSkill = true;
        const skillId = interaction.values[0]; // الآيدي المختار
        const userSkills = getAllSkillData(sql, member);
        skillData = Object.values(userSkills).find(s => s.id === skillId);
        
        if (!skillData) return interaction.reply({ content: "❌ خطأ في المهارة.", flags: [MessageFlags.Ephemeral] });
    } else if (customId !== 'boss_attack') return;

    // الكولداون (إعفاء الأونر)
    const isOwner = (userID === OWNER_ID); 
    const now = Date.now();
    
    if (!isOwner) {
        const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
        if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
            const minutes = Math.floor(((cooldownData.lastHit + HIT_COOLDOWN) - now) / 60000);
            return interaction.reply({ content: `⏳ **انتظر!** باقي **${minutes} دقيقة**.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // حساب الضرر
    let damage = 10; 
    const userRace = getUserRace(member, sql);
    let weaponName = "خنجر صدئ";

    if (userRace) {
        const weapon = getWeaponData(sql, member);
        if (weapon && weapon.currentLevel > 0) {
            damage = weapon.currentDamage; 
            weaponName = weapon.name;
        } else {
            damage = 15; 
            weaponName = "يد عارية";
        }
    }

    let logIcon = '⚔️';
    let attackDescription = "";

    if (isSkill && skillData) {
        const multiplier = 1 + (skillData.effectValue / 100); 
        damage = Math.floor(damage * multiplier);
        logIcon = skillData.emoji || '✨';
        attackDescription = `استخدمت **${skillData.name}**!`;
    } else {
        attackDescription = `هجوم بـ **${weaponName}**!`;
    }

    const isCrit = Math.random() < 0.2;
    if (isCrit) {
        damage = Math.floor(damage * 1.5);
        attackDescription += " (Critical!)";
    }

    // تطبيق الضرر
    let newHP = boss.currentHP - damage;
    if (newHP < 0) newHP = 0;

    const newLogStr = updateBossLog(boss, member.displayName, damage, logIcon);
    sql.prepare("UPDATE world_boss SET currentHP = ?, lastLog = ? WHERE guildID = ?").run(newHP, newLogStr, guildID);
    
    if (!isOwner) {
        sql.prepare("INSERT OR REPLACE INTO boss_cooldowns (guildID, userID, lastHit) VALUES (?, ?, ?)").run(guildID, userID, now);
    }

    const userDmgRecord = sql.prepare("SELECT totalDamage FROM boss_leaderboard WHERE guildID = ? AND userID = ?").get(guildID, userID);
    sql.prepare("INSERT OR REPLACE INTO boss_leaderboard (guildID, userID, totalDamage) VALUES (?, ?, ?)").run(guildID, userID, (userDmgRecord ? userDmgRecord.totalDamage : 0) + damage);

    // الجوائز (بسيطة)
    let rewardMsg = "تم تسجيل الضربة!";
    const roll = Math.random() * 100;
    let userData = client.getLevel.get(userID, guildID) || { ...client.defaultData, user: userID, guild: guildID };
    
    if (roll > 90) {
        const amount = 500; userData.mora += amount; rewardMsg = `💰 **${amount}** مورا`;
    } else {
        const amount = 100; userData.xp += amount; userData.totalXP += amount; rewardMsg = `✨ **${amount}** خبرة`;
    }
    client.setLevel.run(userData);

    // --- تحديث الرسالة (نفس الستايل بالضبط) ---
    const bossMsg = await interaction.channel.messages.fetch(boss.messageID).catch(() => null);
    if (bossMsg) {
        const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
        const progressBar = createProgressBar(newHP, boss.maxHP, 20);
        
        let logsArr = [];
        try { logsArr = JSON.parse(newLogStr); } catch(e){}
        const logDisplay = logsArr.length > 0 ? logsArr.join('\n') : "╰ ...";

        const newEmbed = EmbedBuilder.from(bossMsg.embeds[0])
            .setDescription(
                `**${boss.name}** يظهر في ساحة المعركة!\n\n` +
                `✬ **الـحـالـة الـصـحـيـة:**\n` +
                `${progressBar} **${hpPercent}%**\n` +
                `╰ **${newHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} HP\n\n` +
                `✬ **سـجـل الـمـعـركـة:**\n` +
                `${logDisplay}`
            )
            .setFields([]); // تأكيد إزالة الحقول

        // تحديث الأزرار
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setLabel('حالة الوحش').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
        );

        if (newHP <= 0) {
            newEmbed.setTitle(`💀 **سقط ${boss.name}!**`)
                .setDescription(`🎉 **النصر للأبطال!**\n\n👑 صاحب الضربة القاضية:\n**${member.displayName}**`)
                .setColor(Colors.Gold);
            await bossMsg.edit({ embeds: [newEmbed], components: [] });
            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);
            return interaction.reply({ content: `⚔️ **قضيت عليه!** (-${damage.toLocaleString()})\n🏆 ${rewardMsg}`, flags: [MessageFlags.Ephemeral] });
        } else {
            await bossMsg.edit({ embeds: [newEmbed], components: [row] });
        }
    }

    await interaction.reply({ content: `⚔️ **${attackDescription}**\nسببت **${damage.toLocaleString()}** ضرر!\n🎁 ${rewardMsg}`, flags: [MessageFlags.Ephemeral] });
}

module.exports = { handleBossInteraction };
