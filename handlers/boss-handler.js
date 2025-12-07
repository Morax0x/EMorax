const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, ComponentType } = require("discord.js");
const { getWeaponData, getUserRace, getAllSkillData } = require('./pvp-core.js');

// 🛠️ إعدادات الأونر (ضع الـ ID الخاص بك هنا لإلغاء الكولداون)
const OWNER_IDS = ['YOUR_ID_HERE', 'ANOTHER_ID_IF_NEEDED']; 

const HIT_COOLDOWN = 2 * 60 * 60 * 1000; // ساعتين
const EMOJI_MORA = '<:mora:1435647151349698621>';

/**
 * دالة مساعدة لرسم شريط الحياة
 */
function createProgressBar(current, max, length = 15) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    // يمكنك تغيير الإيموجي هنا لشكل أجمل
    return '🟥'.repeat(filled) + '⬛'.repeat(empty); 
}

/**
 * دالة لتحديث سجل الضربات (آخر 3)
 */
function updateBossLog(boss, username, damage, type = '⚔️') {
    let logs = [];
    try { logs = JSON.parse(boss.lastLog || '[]'); } catch (e) {}
    
    // إضافة السجل الجديد في البداية
    logs.unshift(`**${username}**: ${type} \`-${damage}\``);
    
    // الاحتفاظ بآخر 3 فقط
    if (logs.length > 3) logs = logs.slice(0, 3);
    
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
        return interaction.reply({ content: "❌ **الوحش غير موجود!** (ربما تم القضاء عليه أو هرب).", ephemeral: true });
    }

    // --- 1. زر "حالة الوحش" (Status) ---
    if (customId === 'boss_status') {
        // جلب التوب 5 من الداتابيس
        const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 5").all(guildID);
        
        let lbText = leaderboard.length > 0 
            ? leaderboard.map((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index+1}`;
                return `${medal} <@${entry.userID}> : **${entry.totalDamage.toLocaleString()}** ضرر`;
            }).join('\n') 
            : "لا يوجد سجلات بعد.";

        const statusEmbed = new EmbedBuilder()
            .setTitle(`📊 تقرير المعركة: ${boss.name}`)
            .setColor(Colors.Blue)
            .setThumbnail(boss.image || null)
            .addFields(
                { name: "❤️ الصحة الحالية", value: `${boss.currentHP.toLocaleString()} / ${boss.maxHP.toLocaleString()}`, inline: true },
                { name: "⏳ الحالة", value: "نشط وهائج", inline: true },
                { name: "⚔️ أبطال المعركة (Top Damage)", value: lbText, inline: false }
            )
            .setFooter({ text: "استمر في الهجوم لتصدر القائمة!" });

        return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
    }

    // --- 2. زر "قائمة المهارات" (Skills Menu) ---
    if (customId === 'boss_skill_menu') {
        const userSkills = getAllSkillData(sql, member);
        const availableSkills = Object.values(userSkills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));

        if (availableSkills.length === 0) {
            return interaction.reply({ content: "❌ ليس لديك مهارات مفعلة لاستخدامها!", ephemeral: true });
        }

        const rows = [];
        let currentRow = new ActionRowBuilder();

        // إنشاء أزرار للمهارات (بحد أقصى 5 في الصف)
        availableSkills.slice(0, 5).forEach(skill => {
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`boss_use_skill_${skill.id}`)
                    .setLabel(skill.name)
                    .setEmoji(skill.emoji || '✨') // تأكد من وجود ايموجي أو استخدم افتراضي
                    .setStyle(ButtonStyle.Primary)
            );
        });
        rows.push(currentRow);

        return interaction.reply({ 
            content: "✨ **اختر المهارة التي تريد استخدامها:**", 
            components: rows, 
            ephemeral: true 
        });
    }

    // --- 3. معالجة الهجوم (عادي أو مهارة) ---
    let isSkill = false;
    let skillData = null;

    if (customId.startsWith('boss_use_skill_')) {
        isSkill = true;
        const skillId = customId.replace('boss_use_skill_', '');
        const userSkills = getAllSkillData(sql, member);
        skillData = Object.values(userSkills).find(s => s.id === skillId);
        if (!skillData) return interaction.reply({ content: "❌ مهارة غير صالحة.", ephemeral: true });
    } else if (customId !== 'boss_attack') {
        return; // ليس زر وحش
    }

    // --- التحقق من الكولداون ---
    const isOwner = OWNER_IDS.includes(userID); // ✅ تخطي الكولداون للأونر
    const now = Date.now();
    
    if (!isOwner) {
        const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
        if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
            const timeLeft = (cooldownData.lastHit + HIT_COOLDOWN) - now;
            const minutes = Math.floor(timeLeft / 60000);
            return interaction.reply({ content: `⏳ **اهدأ يا محارب!**\nتحتاج للراحة قبل الهجوم مرة أخرى.\nالوقت المتبقي: **${minutes} دقيقة**.`, ephemeral: true });
        }
    }

    // --- حساب الضرر ---
    let damage = 50; // ضرر أساسي
    const userRace = getUserRace(member, sql);
    let weaponName = "قبضة اليد";

    // حساب ضرر السلاح
    if (userRace) {
        const weapon = getWeaponData(sql, member);
        if (weapon && weapon.currentLevel > 0) {
            damage += (weapon.currentDamage * 2); // السلاح
            weaponName = weapon.name;
        } else {
            damage += 20; // العرق بدون سلاح
        }
    }

    // إذا كان استخدام مهارة، نقوم بتعديل الضرر
    let logIcon = '⚔️';
    let attackDescription = "";

    if (isSkill && skillData) {
        // معادلة بسيطة: المهارة تضرب نسبة مئوية من ضرر السلاح أو قيمة ثابتة عالية
        // هنا سنفترض أن value_increment للمهارة هو نسبة زيادة في الضرر
        const multiplier = 1 + (skillData.effectValue / 100); 
        damage = Math.floor(damage * multiplier);
        damage = Math.floor(damage * 1.2); // بونص إضافي لاستخدام المهارة
        logIcon = skillData.emoji || '✨';
        attackDescription = `استخدمت **${skillData.name}**!`;
    } else {
        attackDescription = `هجوم بـ **${weaponName}**!`;
    }

    // ضربة حرجة
    const isCrit = Math.random() < 0.2;
    if (isCrit) {
        damage = Math.floor(damage * 1.5);
        attackDescription += " (Critical! 🔥)";
    }

    // --- تطبيق التغييرات على الداتابيس ---
    
    // 1. خصم الصحة
    let newHP = boss.currentHP - damage;
    if (newHP < 0) newHP = 0;

    // 2. تحديث السجل
    const newLogStr = updateBossLog(boss, member.displayName, damage, logIcon);

    // 3. تحديث جدول الوحش
    sql.prepare("UPDATE world_boss SET currentHP = ?, lastLog = ? WHERE guildID = ?").run(newHP, newLogStr, guildID);
    
    // 4. تحديث الكولداون (إلا لو أونر)
    if (!isOwner) {
        sql.prepare("INSERT OR REPLACE INTO boss_cooldowns (guildID, userID, lastHit) VALUES (?, ?, ?)").run(guildID, userID, now);
    }

    // 5. تحديث جدول الترتيب (Leaderboard)
    const userDmgRecord = sql.prepare("SELECT totalDamage FROM boss_leaderboard WHERE guildID = ? AND userID = ?").get(guildID, userID);
    const newTotalDamage = (userDmgRecord ? userDmgRecord.totalDamage : 0) + damage;
    sql.prepare("INSERT OR REPLACE INTO boss_leaderboard (guildID, userID, totalDamage) VALUES (?, ?, ?)").run(guildID, userID, newTotalDamage);

    // --- توزيع الجوائز (نفس المنطق السابق) ---
    let rewardMsg = "";
    const roll = Math.random() * 100;
    let userData = client.getLevel.get(userID, guildID);
    if (!userData) userData = { ...client.defaultData, user: userID, guild: guildID };
    const luckBonus = damage / 500;

    if (roll + luckBonus > 95) { 
        const discount = Math.floor(Math.random() * 10) + 1;
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **أسطوري!** كوبون خصم **${discount}%**`;
    } else if (roll > 80) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 500) + 100;
        if (isMora) userData.mora += amount; else userData.xp += amount;
        rewardMsg = `🧪 **نادر!** ${amount} ${isMora ? 'مورا' : 'XP'}`;
    } else if (roll > 40) {
        const amount = Math.floor(Math.random() * 900) + 50;
        userData.mora += amount;
        rewardMsg = `💰 **${amount}** مورا`;
    } else {
        const amount = Math.floor(Math.random() * 900) + 20;
        userData.xp += amount;
        userData.totalXP += amount;
        rewardMsg = `✨ **${amount}** خبرة`;
    }
    client.setLevel.run(userData);

    // --- تحديث الرسالة (Main Embed Update) ---
    const bossMsg = await interaction.channel.messages.fetch(boss.messageID).catch(() => null);
    if (bossMsg) {
        const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
        const progressBar = createProgressBar(newHP, boss.maxHP, 18);
        
        // تحضير نص السجل للعرض
        let logsArr = [];
        try { logsArr = JSON.parse(newLogStr); } catch(e){}
        const logDisplay = logsArr.length > 0 ? logsArr.join('\n') : "لا يوجد ضربات حديثة...";

        const newEmbed = new EmbedBuilder()
            .setTitle(`👹 **WORLD BOSS: ${boss.name}**`)
            .setDescription(`⚠️ **تحذير:** وحش أسطوري يهاجم المنطقة! تعاونوا لهزيمته.`)
            .setColor(Colors.DarkRed)
            .setImage(boss.image)
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/1041/1041891.png') // أيقونة تحذير أو سيف
            .addFields(
                { 
                    name: `🩸 الحالة الصحية (${hpPercent}%)`, 
                    value: `${progressBar}\n**${newHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} HP` 
                },
                { 
                    name: `🛡️ سجل المعركة (آخر الضربات)`, 
                    value: logDisplay 
                }
            )
            .setFooter({ text: "استخدم الأزرار أدناه للمشاركة في القتال!" })
            .setTimestamp();

        // تحديث الأزرار (نفسها)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setLabel('حالة الوحش').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
        );

        if (newHP <= 0) {
            // الوحش مات
            newEmbed.setTitle(`💀 **سقط ${boss.name}!**`)
                .setDescription(`🎉 **النصر للأبطال!**\n👑 الضربة القاضية: **${member.displayName}**\n\nسيتم توزيع غنائم إضافية قريباً...`)
                .setColor(Colors.Gold)
                .setFields([]); // إزالة الحقول القديمة
            
            await bossMsg.edit({ embeds: [newEmbed], components: [] });
            
            // تنظيف الجداول
            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID); // تصفير الترتيب للوحش القادم

            return interaction.reply({ 
                content: `⚔️ **الضربة القاضية!** (-${damage})\nلقد قتلت الوحش! 🏆\n${rewardMsg}`, 
                ephemeral: true 
            });
        } else {
            await bossMsg.edit({ embeds: [newEmbed], components: [row] });
        }
    }

    // رد التفاعل (Ephemeral)
    await interaction.reply({ 
        content: `⚔️ **${attackDescription}**\nسببت **${damage}** ضرر!\n🎁 الجائزة: ${rewardMsg}`, 
        ephemeral: true 
    });
}

module.exports = { handleBossInteraction };
