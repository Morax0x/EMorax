const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, MessageFlags } = require("discord.js");
const { getWeaponData, getUserRace, getAllSkillData } = require('./pvp-core.js');

// 👑 الآيدي الخاص بك (بدون كولداون)
const OWNER_ID = '1145327691772481577'; 

const HIT_COOLDOWN = 2 * 60 * 60 * 1000; // ساعتين للأعضاء
const EMOJI_MORA = '<:mora:1435647151349698621>'; 

// دالة رسم الشريط
function createProgressBar(current, max, length = 18) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '🟥'.repeat(filled) + '⬛'.repeat(empty);
}

// دالة السجل
function updateBossLog(boss, username, damage, type = '⚔️') {
    let logs = [];
    try { logs = JSON.parse(boss.lastLog || '[]'); } catch (e) {}
    logs.unshift(`**${username}**: ${type} \`-${damage}\``);
    if (logs.length > 5) logs = logs.slice(0, 5); 
    return JSON.stringify(logs);
}

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton()) return;
    
    const { customId, guild, user, member } = interaction;
    const guildID = guild.id;
    const userID = user.id;

    // جلب بيانات الوحش
    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    
    if (!boss) {
        return interaction.reply({ content: "❌ **الوحش غير موجود!**", flags: [MessageFlags.Ephemeral] });
    }

    // =========================================================
    // 1. زر الحالة (Status)
    // =========================================================
    if (customId === 'boss_status') {
        const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 5").all(guildID);
        let lbText = leaderboard.length > 0 
            ? leaderboard.map((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index+1}`;
                return `${medal} <@${entry.userID}> : **${entry.totalDamage.toLocaleString()}** ضرر`;
            }).join('\n') 
            : "لا يوجد سجلات.";

        const statusEmbed = new EmbedBuilder()
            .setTitle(`📊 تقرير المعركة: ${boss.name}`)
            .setColor(Colors.Blue)
            .setThumbnail(boss.image || null)
            .addFields(
                { name: "❤️ الصحة", value: `${boss.currentHP.toLocaleString()}`, inline: true },
                { name: "⚔️ الأبطال", value: lbText, inline: false }
            );
        return interaction.reply({ embeds: [statusEmbed], flags: [MessageFlags.Ephemeral] });
    }

    // =========================================================
    // 2. زر المهارات (Skills) - تم الإصلاح ✅
    // =========================================================
    if (customId === 'boss_skill_menu') {
        const userSkills = getAllSkillData(sql, member);
        // تصفية المهارات المتاحة
        const availableSkills = Object.values(userSkills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));

        if (availableSkills.length === 0) {
            return interaction.reply({ content: "❌ ليس لديك مهارات نشطة لاستخدامها.", flags: [MessageFlags.Ephemeral] });
        }

        const rows = [];
        let currentRow = new ActionRowBuilder();
        
        // عرض أول 5 مهارات فقط لتجنب أخطاء الديسكورد
        availableSkills.slice(0, 5).forEach(skill => {
            // التحقق من الايموجي لتجنب الكراش
            let skillEmoji = '✨'; 
            // إذا كان الايموجي نصاً وبصيغة صحيحة نستخدمه
            if (skill.emoji && (skill.emoji.match(/<a?:.+?:\d+>/) || skill.emoji.match(/(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/))) {
                skillEmoji = skill.emoji;
            }

            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`boss_use_skill_${skill.id}`)
                    .setLabel(skill.name.substring(0, 80)) // تقصير الاسم لو طويل
                    .setEmoji(skillEmoji)
                    .setStyle(ButtonStyle.Primary)
            );
        });
        rows.push(currentRow);

        return interaction.reply({ 
            content: "✨ **اختر مهارة للهجوم:**", 
            components: rows, 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    // =========================================================
    // 3. معالجة الهجوم (عادي أو مهارة)
    // =========================================================
    let isSkill = false;
    let skillData = null;

    if (customId.startsWith('boss_use_skill_')) {
        isSkill = true;
        const skillId = customId.replace('boss_use_skill_', '');
        const userSkills = getAllSkillData(sql, member);
        skillData = Object.values(userSkills).find(s => s.id === skillId);
        
        if (!skillData) return interaction.reply({ content: "❌ خطأ: المهارة غير موجودة.", flags: [MessageFlags.Ephemeral] });
    
    } else if (customId !== 'boss_attack') {
        return; 
    }

    // ✅ التحقق من الكولداون (الأونر معفي)
    const isOwner = (userID === OWNER_ID); 
    const now = Date.now();
    
    if (!isOwner) {
        const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
        if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
            const timeLeft = (cooldownData.lastHit + HIT_COOLDOWN) - now;
            const minutes = Math.floor(timeLeft / 60000);
            return interaction.reply({ content: `⏳ **انتظر قليلاً!**\nعليك الانتظار **${minutes} دقيقة** قبل الهجوم التالي.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // ✅ حساب الضرر (إصلاح: استخدام الضرر الخام)
    let damage = 10; // الافتراضي (خنجر)
    const userRace = getUserRace(member, sql);
    let weaponName = "خنجر صدئ";

    if (userRace) {
        const weapon = getWeaponData(sql, member);
        if (weapon && weapon.currentLevel > 0) {
            // ✅ استخدام الضرر الموجود في الداتابيس مباشرة بدون تغيير
            damage = weapon.currentDamage; 
            weaponName = weapon.name;
        } else {
            // لديه عرق لكن بدون سلاح
            damage = 15; 
            weaponName = "يد عارية";
        }
    }

    let logIcon = '⚔️';
    let attackDescription = "";

    // تأثير المهارة على الضرر
    if (isSkill && skillData) {
        // المهارة تزيد الضرر بنسبة مئوية بسيطة فوق ضرر السلاح
        // أو يمكنك جعلها: damage = damage + skillData.effectValue;
        const multiplier = 1 + (skillData.effectValue / 100); 
        damage = Math.floor(damage * multiplier);
        
        logIcon = skillData.emoji || '✨';
        attackDescription = `استخدمت مهارة **${skillData.name}**!`;
    } else {
        attackDescription = `هجوم بـ **${weaponName}**!`;
    }

    // ضربة حرجة
    const isCrit = Math.random() < 0.2;
    if (isCrit) {
        damage = Math.floor(damage * 1.5);
        attackDescription += " (Critical! 🔥)";
    }

    // =========================================================
    // 4. الحفظ في الداتابيس
    // =========================================================
    let newHP = boss.currentHP - damage;
    if (newHP < 0) newHP = 0;

    const newLogStr = updateBossLog(boss, member.displayName, damage, logIcon);
    sql.prepare("UPDATE world_boss SET currentHP = ?, lastLog = ? WHERE guildID = ?").run(newHP, newLogStr, guildID);
    
    if (!isOwner) {
        sql.prepare("INSERT OR REPLACE INTO boss_cooldowns (guildID, userID, lastHit) VALUES (?, ?, ?)").run(guildID, userID, now);
    }

    const userDmgRecord = sql.prepare("SELECT totalDamage FROM boss_leaderboard WHERE guildID = ? AND userID = ?").get(guildID, userID);
    const newTotalDamage = (userDmgRecord ? userDmgRecord.totalDamage : 0) + damage;
    sql.prepare("INSERT OR REPLACE INTO boss_leaderboard (guildID, userID, totalDamage) VALUES (?, ?, ?)").run(guildID, userID, newTotalDamage);

    // =========================================================
    // 5. الجوائز
    // =========================================================
    let rewardMsg = "";
    const roll = Math.random() * 100;
    let userData = client.getLevel.get(userID, guildID);
    if (!userData) userData = { ...client.defaultData, user: userID, guild: guildID };
    
    const luckBonus = damage / 800; // كلما زاد الضرر زاد الحظ قليلاً

    if (roll + luckBonus > 96) { 
        const discount = Math.floor(Math.random() * 10) + 1;
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **أسطوري!** كوبون خصم **${discount}%**`;
    } else if (roll > 85) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 400) + 100;
        if (isMora) userData.mora += amount; else userData.xp += amount;
        rewardMsg = `🧪 **نادر!** ${amount} ${isMora ? 'مورا' : 'XP'}`;
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

    // =========================================================
    // 6. تحديث الرسالة
    // =========================================================
    const bossMsg = await interaction.channel.messages.fetch(boss.messageID).catch(() => null);
    if (bossMsg) {
        const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
        const progressBar = createProgressBar(newHP, boss.maxHP, 18);
        
        let logsArr = [];
        try { logsArr = JSON.parse(newLogStr); } catch(e){}
        const logDisplay = logsArr.length > 0 ? logsArr.join('\n') : "انتظار الضربة الأولى...";

        const newEmbed = EmbedBuilder.from(bossMsg.embeds[0])
            .setDescription(`⚠️ **تحذير:** وحش أسطوري يهاجم المنطقة!\n\n` + 
                            `📊 **الحالة:** ${hpPercent}% متبقي\n` +
                            `${progressBar}`)
            .setFields([
                { name: `🩸 الصحة`, value: `**${newHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} HP`, inline: true },
                { name: `🛡️ سجل المعركة`, value: logDisplay, inline: false }
            ]);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setLabel('حالة الوحش').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
        );

        if (newHP <= 0) {
            newEmbed.setTitle(`💀 **سقط ${boss.name}!**`)
                .setDescription(`🎉 **النصر!**\n👑 القاتل: **${member.displayName}**`)
                .setColor(Colors.Gold)
                .setFields([]); 
            
            await bossMsg.edit({ embeds: [newEmbed], components: [] });
            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);

            return interaction.reply({ content: `⚔️ **الضربة القاضية!** (-${damage})\n🏆 ${rewardMsg}`, flags: [MessageFlags.Ephemeral] });
        } else {
            await bossMsg.edit({ embeds: [newEmbed], components: [row] });
        }
    }

    // الرد النهائي (مخفي)
    await interaction.reply({ 
        content: `⚔️ **${attackDescription}**\nسببت **${damage}** ضرر!\n🎁 ${rewardMsg}`, 
        flags: [MessageFlags.Ephemeral] 
    });
}

module.exports = { handleBossInteraction };
