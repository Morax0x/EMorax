const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Colors, MessageFlags } = require("discord.js");
const { getWeaponData, getUserRace, getAllSkillData } = require('./pvp-core.js');

// 👑 الآيدي الخاص بك (بدون كولداون)
const OWNER_ID = '1145327691772481577'; 

const HIT_COOLDOWN = 2 * 60 * 60 * 1000; 
const EMOJI_MORA = '<:mora:1435647151349698621>'; 

// ✅ دالة رسم الشريط الجديدة (█ ░) وعدد محدود (12)
function createProgressBar(current, max, length = 12) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// ✅ دالة السجل الجديدة (تنسيق محدد مع الرقم الأسود)
// الصيغة: ╰ Name: استعمل [Tool] وتسبب بضرر `Damage`
function updateBossLog(boss, displayName, toolName, damage) {
    let logs = [];
    try { logs = JSON.parse(boss.lastLog || '[]'); } catch (e) {}
    
    const logEntry = `╰ **${displayName}**: استعمل **${toolName}** وتسبب بضرر \`${damage.toLocaleString()}\``;
    
    logs.unshift(logEntry);
    if (logs.length > 3) logs = logs.slice(0, 3); // آخر 3 هجمات فقط
    return JSON.stringify(logs);
}

// دالة تحديد حالة الزعيم
function getBossState(current, max) {
    const percent = (current / max) * 100;
    if (percent > 75) return "مستعد للقتال";
    if (percent > 50) return "هائج 🔥";
    if (percent > 25) return "متعب 💢";
    return "يحتضر ☠️";
}

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    
    const { customId, guild, user, member } = interaction;
    const guildID = guild.id;
    const userID = user.id;

    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    if (!boss) return interaction.reply({ content: "❌ **الوحش مات!**", flags: [MessageFlags.Ephemeral] });

    // =========================================================
    // 1. زر الحالة (❗) - التقرير
    // =========================================================
    if (customId === 'boss_status') {
        const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 5").all(guildID);
        
        let lbText = leaderboard.length > 0 
            ? leaderboard.map((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index+1}`;
                return `${medal} <@${entry.userID}> : **${entry.totalDamage.toLocaleString()}**`;
            }).join('\n') 
            : "لا يوجد سجلات.";

        const statusEmbed = new EmbedBuilder()
            .setTitle(`✶ تـقـريـر المعـركـة`)
            .setColor(Colors.Blue)
            .setDescription(
                `✬ الـصـحـة: ${boss.currentHP.toLocaleString()} / ${boss.maxHP.toLocaleString()}\n` +
                `✬ الـحـالـة: ${getBossState(boss.currentHP, boss.maxHP)}\n\n` +
                `✬ أبـطـال الـمـعـركـة:\n${lbText}`
            );
        
        if (boss.image) statusEmbed.setThumbnail(boss.image); // نفس صورة البوس

        return interaction.reply({ embeds: [statusEmbed], flags: [MessageFlags.Ephemeral] });
    }

    // =========================================================
    // 2. زر المهارات (يفتح القائمة)
    // =========================================================
    if (customId === 'boss_skill_menu') {
        const userSkills = getAllSkillData(sql, member);
        const availableSkills = Object.values(userSkills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));

        if (availableSkills.length === 0) {
            return interaction.reply({ content: "❌ **ما عندك مهارات!**\nطور مهاراتك من المتجر أو احصل على عرق.", flags: [MessageFlags.Ephemeral] });
        }

        // إنشاء القائمة المنسدلة
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('boss_execute_skill')
            .setPlaceholder('✨ اختر المهارة...')
            .addOptions(
                availableSkills.slice(0, 25).map(skill => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(skill.name)
                        .setDescription(`القوة: ${skill.effectValue}%`)
                        .setValue(skill.id)
                        .setEmoji(skill.emoji || '✨')
                )
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({ content: "**اختر المهارة:**", components: [row], flags: [MessageFlags.Ephemeral] });
    }

    // =========================================================
    // 3. التنفيذ (هجوم أو مهارة)
    // =========================================================
    let isSkill = false;
    let skillData = null;

    // استلام اختيار القائمة المنسدلة
    if (customId === 'boss_execute_skill') {
        isSkill = true;
        const skillId = interaction.values[0]; 
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

    // حساب الضرر والسلاح
    let damage = 10; 
    const userRace = getUserRace(member, sql);
    let toolName = "خنجر"; // الاسم الذي سيظهر في السجل

    if (userRace) {
        const weapon = getWeaponData(sql, member);
        if (weapon && weapon.currentLevel > 0) {
            damage = weapon.currentDamage; 
            toolName = weapon.name;
        } else {
            damage = 15; 
            toolName = "خنجر (افتراضي)";
        }
    }

    // تعديل الضرر إذا كان مهارة
    if (isSkill && skillData) {
        const multiplier = 1 + (skillData.effectValue / 100); 
        damage = Math.floor(damage * multiplier);
        toolName = skillData.name; // تغيير اسم الأداة لاسم المهارة
    }

    // الضربة الحرجة
    let isCrit = false;
    if (Math.random() < 0.2) {
        damage = Math.floor(damage * 1.5);
        isCrit = true;
    }

    // تطبيق الضرر
    let newHP = boss.currentHP - damage;
    if (newHP < 0) newHP = 0;

    // تحديث السجل بالشكل الجديد
    const newLogStr = updateBossLog(boss, member.displayName, toolName, damage);
    
    sql.prepare("UPDATE world_boss SET currentHP = ?, lastLog = ? WHERE guildID = ?").run(newHP, newLogStr, guildID);
    
    if (!isOwner) {
        sql.prepare("INSERT OR REPLACE INTO boss_cooldowns (guildID, userID, lastHit) VALUES (?, ?, ?)").run(guildID, userID, now);
    }

    const userDmgRecord = sql.prepare("SELECT totalDamage FROM boss_leaderboard WHERE guildID = ? AND userID = ?").get(guildID, userID);
    sql.prepare("INSERT OR REPLACE INTO boss_leaderboard (guildID, userID, totalDamage) VALUES (?, ?, ?)").run(guildID, userID, (userDmgRecord ? userDmgRecord.totalDamage : 0) + damage);

    // الجوائز
    let rewardMsg = "";
    const roll = Math.random() * 100;
    let userData = client.getLevel.get(userID, guildID) || { ...client.defaultData, user: userID, guild: guildID };
    const luckBonus = damage / 800;

    if (roll + luckBonus > 96) { 
        const discount = Math.floor(Math.random() * 10) + 1;
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **كوبون خصم ${discount}%**`;
    } else if (roll > 85) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 400) + 100;
        if (isMora) userData.mora += amount; else userData.xp += amount;
        rewardMsg = `🧪 **${amount}** ${isMora ? 'مورا' : 'XP'}`;
    } else if (roll > 40) {
        const amount = Math.floor(Math.random() * 500) + 50;
        userData.mora += amount;
        rewardMsg = `💰 **${amount}** مورا`;
    } else {
        const amount = Math.floor(Math.random() * 500) + 20;
        userData.xp += amount;
        userData.totalXP += amount;
        rewardMsg = `✨ **${amount}** خبرة`;
    }
    client.setLevel.run(userData);

    // --- تحديث الرسالة (الشكل الجديد) ---
    const bossMsg = await interaction.channel.messages.fetch(boss.messageID).catch(() => null);
    if (bossMsg) {
        const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
        const progressBar = createProgressBar(newHP, boss.maxHP, 12); // نفس طول الأمر
        
        let logsArr = [];
        try { logsArr = JSON.parse(newLogStr); } catch(e){}
        const logDisplay = logsArr.length > 0 ? logsArr.join('\n') : "╰ بانتظار الهجوم الأول...";

        // الحفاظ على الصورة والثامبنيل القديمين
        const oldEmbed = bossMsg.embeds[0];
        const newEmbed = EmbedBuilder.from(oldEmbed)
            .setDescription(
                `✬ ظـهـر زعـيـم في السـاحـة تـعانـوا عـلـى قتاله واكسبوا الجوائـز !\n\n` +
                `✬ **نـقـاط صـحـة الزعـيـم:**\n` +
                `${progressBar} **${hpPercent}%**\n` +
                `╰ **${newHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} HP\n\n` +
                `✬ **سـجـل الـمـعـركـة:**\n` +
                `${logDisplay}`
            )
            .setFields([]); // التأكد من عدم وجود Fields

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setStyle(ButtonStyle.Secondary).setEmoji('❗')
        );

        if (newHP <= 0) {
            newEmbed.setTitle(`💀 **سقط ${boss.name}!**`)
                .setDescription(`🎉 **النصر للأبطال!**\n\n👑 صاحب الضربة القاضية:\n**${member.displayName}**`)
                .setColor(Colors.Gold);
            await bossMsg.edit({ embeds: [newEmbed], components: [] });
            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);
            
            // رد الضربة القاضية
            return interaction.reply({ 
                content: `⚔️ **استعملت ${toolName} وتسببت بضرر \`${damage.toLocaleString()}\` (قاضية!)**\n🏆 ${rewardMsg}`, 
                flags: [MessageFlags.Ephemeral] 
            });
        } else {
            await bossMsg.edit({ embeds: [newEmbed], components: [row] });
        }
    }

    // الرد النهائي (مخفي)
    const critText = isCrit ? " (Critical!)" : "";
    await interaction.reply({ 
        content: `⚔️ **استعملت ${toolName} وتسببت بضرر \`${damage.toLocaleString()}\`${critText}**\n🎁 ${rewardMsg}`, 
        flags: [MessageFlags.Ephemeral] 
    });
}

module.exports = { handleBossInteraction };
