const { EmbedBuilder, Colors } = require("discord.js");
const { getWeaponData, getUserRace } = require('./pvp-core.js'); // ✅ استيراد الدوال من ملف الكور

const HIT_COOLDOWN = 2 * 60 * 60 * 1000; // ساعتين
const EMOJI_MORA = '<:mora:1435647151349698621>';

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'boss_attack' && interaction.customId !== 'boss_status') return;

    const guildID = interaction.guild.id;
    const userID = interaction.user.id;

    // جلب بيانات الوحش
    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    
    if (!boss) {
        return interaction.reply({ content: "❌ الوحش مات أو هرب! لا يوجد قتال حالياً.", ephemeral: true });
    }

    if (interaction.customId === 'boss_status') {
        const percent = Math.floor((boss.currentHP / boss.maxHP) * 100);
        return interaction.reply({ content: `📊 **حالة ${boss.name}:**\n❤️ الصحة: **${boss.currentHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} (${percent}%)`, ephemeral: true });
    }

    // --- معالجة الهجوم ---
    
    // 1. التحقق من الكولداون
    const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
    const now = Date.now();

    if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
        const timeLeft = (cooldownData.lastHit + HIT_COOLDOWN) - now;
        const minutes = Math.floor(timeLeft / 60000);
        return interaction.reply({ content: `⏳ **انتظر قليلاً!**\nتحتاج للراحة قبل الهجوم مرة أخرى.\nالوقت المتبقي: **${minutes} دقيقة**.`, ephemeral: true });
    }

    // 2. حساب الضرر (بناءً على السلاح والعرق)
    let damage = 50; // ضرر أساسي
    const member = interaction.member;
    const userRace = getUserRace(member, sql);
    
    if (userRace) {
        const weapon = getWeaponData(sql, member);
        if (weapon && weapon.currentLevel > 0) {
            damage += (weapon.currentDamage * 2); // السلاح يؤثر بقوة مضاعفة ضد الوحش
        } else {
            damage += 20; // بونص عرق بسيط بدون سلاح
        }
    }

    // إضافة عشوائية للضرر (Critical Hit)
    const isCrit = Math.random() < 0.2; // 20% فرصة ضربة حرجة
    if (isCrit) damage = Math.floor(damage * 1.5);

    // 3. تطبيق الضرر
    let newHP = boss.currentHP - damage;
    if (newHP < 0) newHP = 0;

    sql.prepare("UPDATE world_boss SET currentHP = ? WHERE guildID = ?").run(newHP, guildID);
    sql.prepare("INSERT OR REPLACE INTO boss_cooldowns (guildID, userID, lastHit) VALUES (?, ?, ?)").run(guildID, userID, now);

    // 4. اختيار الجائزة العشوائية
    let rewardMsg = "";
    const roll = Math.random() * 100;
    let userData = client.getLevel.get(userID, guildID);
    if (!userData) userData = { ...client.defaultData, user: userID, guild: guildID };

    // كلما كان الضرر أعلى، زاد "الحظ" قليلاً في الجوائز النادرة
    const luckBonus = damage / 500; 

    if (roll + luckBonus > 95) { 
        // 🎫 كوبون خصم (نادر جداً)
        const discount = Math.floor(Math.random() * 10) + 1; // 1% to 10%
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **أسطوري!** حصلت على **كوبون خصم ${discount}%** للمتجر!`;
    } 
    else if (roll > 80) {
        // 🧪 بف (مورا أو XP)
        const isMoraBuff = Math.random() > 0.5;
        const percent = Math.floor(Math.random() * 32) + 3; // 3% to 35%
        const durationHours = (Math.random() * 2.9) + 0.1; // 5 min to 3 hours
        const durationMs = durationHours * 60 * 60 * 1000;
        const type = isMoraBuff ? 'mora' : 'xp';
        
        sql.prepare("INSERT INTO user_buffs (userID, guildID, buffType, multiplier, expiresAt, buffPercent) VALUES (?, ?, ?, ?, ?, ?)").run(userID, guildID, type, percent / 100, now + durationMs, percent);
        
        rewardMsg = `🧪 **نادر!** حصلت على معزز **${isMoraBuff ? 'مورا' : 'خبرة'} (+${percent}%)** لمدة **${Math.ceil(durationHours * 60)} دقيقة**!`;
    } 
    else if (roll > 40) {
        // 💰 مورا
        const amount = Math.floor(Math.random() * 949) + 50; // 50 - 999
        userData.mora += amount;
        rewardMsg = `💰 حصلت على **${amount}** ${EMOJI_MORA}!`;
    } 
    else {
        // ✨ XP
        const amount = Math.floor(Math.random() * 979) + 20; // 20 - 999
        userData.xp += amount;
        userData.totalXP += amount;
        rewardMsg = `✨ حصلت على **${amount}** خبرة!`;
    }
    
    client.setLevel.run(userData);

    // 5. تحديث رسالة الوحش (الإيمبد)
    const bossMsg = await interaction.channel.messages.fetch(boss.messageID).catch(() => null);
    if (bossMsg) {
        // رسم شريط الحياة
        const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
        const barLength = 20;
        const filledLength = Math.floor((barLength * hpPercent) / 100);
        const emptyLength = barLength - filledLength;
        const progressBar = '🟥'.repeat(filledLength) + '⬛'.repeat(emptyLength);

        const newEmbed = EmbedBuilder.from(bossMsg.embeds[0])
            .setDescription(
                `⚠️ **وحش هائج!** تعاونوا للقضاء عليه.\n\n` +
                `🩸 **الصحة:** ${newHP.toLocaleString()} / ${boss.maxHP.toLocaleString()}\n` +
                `${progressBar} **${hpPercent}%**\n\n` +
                `💥 **آخر ضربة:** ${interaction.user.username} (-${damage})\n` +
                `🎁 **الجوائز:** مستمرة مع كل ضربة!`
            );
        
        if (newHP <= 0) {
            newEmbed.setTitle(`💀 **تم القضاء على ${boss.name}!**`)
                .setDescription(`🎉 **النصر!**\nقام الأبطال بهزيمة الوحش.\nصاحب الضربة القاضية: **${interaction.user}** 👑`)
                .setColor(Colors.Grey);
            
            await bossMsg.edit({ embeds: [newEmbed], components: [] }); // إزالة الأزرار
            
            // تنظيف الداتابيس (إلغاء تفعيل الوحش)
            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            
            return interaction.reply({ content: `⚔️ **ضربة قاضية!** (-${damage})\n لقد قتلت الوحش! 🏆\n${rewardMsg}`, ephemeral: true });
        } else {
            await bossMsg.edit({ embeds: [newEmbed] });
        }
    }

    return interaction.reply({ 
        content: `⚔️ **هجوم ناجح!**\nسببت **${damage}** ضرر للوحش.\n${isCrit ? "**(ضربة حرجة! 🔥)**\n" : ""}\n🎁 **الجائزة:**\n${rewardMsg}`, 
        ephemeral: true 
    });
}

module.exports = { handleBossInteraction };
