const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors } = require("discord.js");

// دالة لمعرفة وزن المستخدم (عدد الفرص)
async function getUserWeight(member, sql) {
    const userRoles = member.roles.cache.map(r => r.id);
    if (userRoles.length === 0) return 1;

    const placeholders = userRoles.map(() => '?').join(',');
    
    try {
        const weights = sql.prepare(`
            SELECT MAX(weight) as maxWeight
            FROM giveaway_weights
            WHERE guildID = ? AND roleID IN (${placeholders})
        `).get(member.guild.id, ...userRoles);
        return weights?.maxWeight || 1;
    } catch (e) {
        return 1; // Fallback في حالة عدم وجود الجدول
    }
}

// دالة بدء القيف اواي (يدوي)
async function startGiveaway(client, interaction, channel, duration, winnerCount, prize, xpReward, moraReward) {
    const endsAt = Date.now() + duration;
    
    const embed = new EmbedBuilder()
        .setTitle("🎉 **GIVEAWAY** 🎉")
        .setDescription(
            `**الجائزة:** ${prize}\n` +
            `**عدد الفائزين:** ${winnerCount}\n` +
            `**ينتهي:** <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:f>)\n\n` +
            `**الجوائز الإضافية:**\n` +
            `💰 مورا: **${moraReward}** | ✨ خبرة: **${xpReward}**\n\n` +
            `اضغط على الزر بالأسفل للمشاركة! ⤵️`
        )
        .setColor(Colors.Blue)
        .setTimestamp(endsAt)
        .setFooter({ text: `ينتهي في` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_join')
            .setLabel('مشاركة (0)')
            .setEmoji('🎉')
            .setStyle(ButtonStyle.Primary)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });

    const sql = client.sql;
    sql.prepare(`
        INSERT INTO active_giveaways (messageID, guildID, channelID, prize, endsAt, winnerCount, xpReward, moraReward, isFinished)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(message.id, interaction.guild.id, channel.id, prize, endsAt, winnerCount, xpReward, moraReward);

    setTimeout(() => {
        endGiveaway(client, message.id);
    }, duration);

    return message;
}

// دالة الانضمام
async function handleJoin(client, interaction) {
    const messageID = interaction.message.id;
    const userID = interaction.user.id;
    const guildID = interaction.guild.id;
    const sql = client.sql;

    const giveaway = sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ? AND isFinished = 0").get(messageID);
    if (!giveaway) {
        return interaction.reply({ content: "❌ هذا القيف اواي منتهي أو غير موجود.", ephemeral: true });
    }

    if (Date.now() > giveaway.endsAt) {
        return interaction.reply({ content: "⏰ لقد انتهى وقت المشاركة!", ephemeral: true });
    }

    const existingEntry = sql.prepare("SELECT * FROM giveaway_entries WHERE giveawayID = ? AND userID = ?").get(messageID, userID);
    if (existingEntry) {
        return interaction.reply({ content: "⚠️ أنت مشارك بالفعل.", ephemeral: true });
    }

    const weight = await getUserWeight(interaction.member, sql);

    sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)").run(messageID, userID, weight);

    const count = sql.prepare("SELECT COUNT(*) as count FROM giveaway_entries WHERE giveawayID = ?").get(messageID).count;
    
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const row = ActionRowBuilder.from(interaction.message.components[0]);
    row.components[0].setLabel(`مشاركة (${count})`);

    await interaction.message.edit({ embeds: [embed], components: [row] });
    
    return interaction.reply({ content: `✅ **تم تسجيل مشاركتك!** (عدد فرصك: ${weight})`, ephemeral: true });
}

// ( 🌟 تم تعديل الدالة لتقبل معامل force للإنهاء اليدوي 🌟 )
async function endGiveaway(client, messageID, force = false) {
    const sql = client.sql; 
    const giveaway = sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ?").get(messageID);

    if (!giveaway) {
        if (force) throw new Error("لم يتم العثور على القيفاواي في قاعدة البيانات.");
        return console.log(`[Giveaway] لم يتم العثور على قيفاواي نشط بالـ ID: ${messageID}`);
    }

    // إذا لم ينتهِ الوقت ولم يتم الإجبار، لا تفعل شيئاً
    if (!force && giveaway.endsAt > Date.now() && giveaway.isFinished === 0) {
        // إعادة جدولة إذا كان الوقت لم يحن (في حال إعادة تشغيل البوت)
        const timeLeft = giveaway.endsAt - Date.now();
        setTimeout(() => endGiveaway(client, messageID), timeLeft);
        return;
    }

    // إذا كان منتهياً بالفعل (isFinished = 1) ولم يتم الإجبار، نتوقف
    if (!force && giveaway.isFinished === 1) {
        return;
    }

    // تحديث الحالة فوراً لمنع التكرار
    sql.prepare("UPDATE active_giveaways SET isFinished = 1 WHERE messageID = ?").run(messageID);

    const entries = sql.prepare("SELECT * FROM giveaway_entries WHERE giveawayID = ?").all(messageID);

    let channel;
    try {
        const guild = await client.guilds.fetch(giveaway.guildID);
        channel = await guild.channels.fetch(giveaway.channelID);
    } catch (e) {
        return console.log("[Giveaway] السيرفر أو القناة غير موجودة.");
    }

    const originalMessage = await channel.messages.fetch(messageID).catch(() => null);

    if (entries.length === 0) {
        if (originalMessage) {
            try {
                const originalEmbed = originalMessage.embeds[0];
                const newEmbed = new EmbedBuilder(originalEmbed.toJSON()); 
                let newTitle = originalEmbed.title;
                if (newTitle && !newTitle.startsWith("[انـتـهـى]")) {
                    newTitle = `[انـتـهـى] ${newTitle}`;
                }
                newEmbed.setTitle(newTitle).setColor("Red").setFooter({ text: "انتهى (لا مشاركين)" });
                
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('g_ended').setLabel('انتهى').setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji('🏁')
                );
                
                await originalMessage.edit({ embeds: [newEmbed], components: [disabledRow] });
                await channel.send({ content: `⚠️ القيفاواي (${giveaway.prize}) انتهى ولم يشارك أحد.` });
            } catch (delErr) {
                console.error(`[Giveaway] Error updating empty giveaway:`, delErr);
            }
        }
        return; 
    }

    // خوارزمية السحب (الموزون)
    const pool = [];
    for (const entry of entries) {
        for (let i = 0; i < entry.weight; i++) {
            pool.push(entry.userID);
        }
    }

    // خلط المصفوفة لزيادة العشوائية
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const winners = new Set();
    const countToWin = Math.min(giveaway.winnerCount, entries.length);
    let attempts = 0;

    while (winners.size < countToWin && attempts < 1000 && pool.length > 0) {
        const randomIndex = Math.floor(Math.random() * pool.length);
        const winnerID = pool[randomIndex];
        winners.add(winnerID);
        
        // إزالة الفائز من البول بالكامل لمنع فوزه مرتين
        // (إلا إذا كنت تريد السماح بالفوز المتعدد لنفس الشخص، حينها أزل هذا السطر)
        // pool = pool.filter(id => id !== winnerID); // هذه العملية مكلفة في المصفوفات الكبيرة، لكنها آمنة هنا
        
        // طريقة أسرع: إزالة العنصر الحالي فقط والاستمرار، مع الاعتماد على Set لمنع التكرار
        // لكن بما أن الشخص له عدة "تذاكر" (وزن)، فمن الأفضل تركه في البول إذا أردنا السحب "مع الإرجاع"
        // ولكن، في القيف اواي العادي، الشخص يفوز بمرة واحدة. لذا نستخدم Set لضمان عدم التكرار.
        attempts++;
    }

    const winnerIDs = Array.from(winners);
    const winnerString = winnerIDs.map(id => `<@${id}>`).join(', ');
    const moraReward = giveaway.moraReward || 0;
    const xpReward = giveaway.xpReward || 0;

    // توزيع الجوائز التلقائية
    if (moraReward > 0 || xpReward > 0) {
        for (const winnerID of winnerIDs) {
            try {
                let levelData = client.getLevel.get(winnerID, giveaway.guildID);
                if (!levelData) {
                     levelData = { ...client.defaultData, user: winnerID, guild: giveaway.guildID };
                }
                const oldLevel = levelData.level; 
                levelData.mora = (levelData.mora || 0) + moraReward;
                levelData.xp = (levelData.xp || 0) + xpReward;
                levelData.totalXP = (levelData.totalXP || 0) + xpReward;
                
                // حساب اللفل أب
                let nextXP = 5 * (levelData.level ** 2) + (50 * levelData.level) + 100;
                while (levelData.xp >= nextXP) {
                    levelData.level++;
                    levelData.xp -= nextXP;
                    nextXP = 5 * (levelData.level ** 2) + (50 * levelData.level) + 100;
                }
                client.setLevel.run(levelData);
                
                // إرسال رسالة الترقية
                if (levelData.level > oldLevel && client.sendLevelUpMessage) {
                    const member = await channel.guild.members.fetch(winnerID).catch(() => null);
                    if (member) {
                        const fakeInteraction = { guild: channel.guild, channel: channel, members: { me: channel.guild.members.me } };
                        await client.sendLevelUpMessage(fakeInteraction, member, levelData.level, oldLevel, levelData);
                    }
                }
            } catch (err) {
                console.error(`[Giveaway] فشل في منح الجوائز للفائز ${winnerID}:`, err);
            }
        }
    }

    const announcementEmbed = new EmbedBuilder()
        .setTitle(`✥ انـتـهى الـقـيفـاواي`)
        .setColor("DarkGrey");
        
    const winnerLabel = winnerIDs.length > 1 ? "الـفـائـزون:" : "الـفـائـز:";
    let winDescription = `✦ ${winnerLabel} ${winnerString}\n✦ الـجـائـزة: **${giveaway.prize}**`;
    
    const fields = [];
    if (moraReward > 0) fields.push({ name: '✦ مـورا', value: `${moraReward} <:mora:1435647151349698621>`, inline: true });
    if (xpReward > 0) fields.push({ name: '✬ اكس بي', value: `${xpReward} <a:levelup:1437805366048985290>`, inline: true });
    if (fields.length > 0) announcementEmbed.setFields(fields);
    
    announcementEmbed.setDescription(winDescription);
    
    await channel.send({ content: winnerString, embeds: [announcementEmbed] });

    if (originalMessage) {
        const originalEmbed = originalMessage.embeds[0];
        const newEmbed = new EmbedBuilder(originalEmbed.toJSON()); 
        let newTitle = originalEmbed.title;
        if (newTitle && !newTitle.startsWith("[انـتـهـى]")) newTitle = `[انـتـهـى] ${newTitle}`;
        
        let newDesc = originalEmbed.description;
        // إزالة التوقيت القديم
        const timeRegex = /.*ينتهي.*<t:\d+:R>.*\n?/i;
        newDesc = newDesc.replace(timeRegex, "");
        
        // تحديث عدد المشاركين
        // نبحث عن أي نص يشبه "عدد المشاركين" ونحدثه، أو نضيفه إذا لم يوجد
        // (بناءً على الكود السابق، الوصف كان يحتوي على الجوائز فقط)
        
        newDesc += `\n\n**${winnerLabel}** ${winnerString}\n**عدد المشاركين:** ${entries.length}`;
        
        newEmbed.setTitle(newTitle).setColor("DarkGrey").setDescription(newDesc).setFooter({ text: "انتهى" });
        
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('g_ended').setLabel(`انتهى (${entries.length})`).setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji('🏁')
        );

        await originalMessage.edit({ embeds: [newEmbed], components: [disabledRow] });
    }
}

// دالة الري-رول
async function rerollGiveaway(client, interaction, messageID) {
    const sql = client.sql;
    const giveaway = sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ?").get(messageID);
    
    if (!giveaway) return interaction.reply({ content: "❌ لم يتم العثور على قيف اواي بهذا الآيدي.", ephemeral: true });
    if (giveaway.isFinished === 0) return interaction.reply({ content: "⚠️ هذا القيف اواي لا يزال جارياً! استخدم أمر الإنهاء أولاً.", ephemeral: true });

    const entries = sql.prepare("SELECT userID, weight FROM giveaway_entries WHERE giveawayID = ?").all(messageID);
    if (entries.length === 0) return interaction.reply({ content: "❌ لا يوجد مشاركين لعمل ري-رول.", ephemeral: true });

    // اختيار فائز واحد بطريقة عشوائية بسيطة (بدون وزن للسرعة، أو مع وزن للعدالة)
    // للعدالة، نستخدم نفس منطق الوزن
    const pool = [];
    for (const entry of entries) {
        for (let i = 0; i < entry.weight; i++) {
            pool.push(entry.userID);
        }
    }
    const winner = pool[Math.floor(Math.random() * pool.length)];
    
    await interaction.reply(`🎉 **الري-رول الجديد!** الفائز هو: <@${winner}>! 🥳`);
}

// دالة إنشاء القيفاواي العشوائي (Drop)
async function createRandomDropGiveaway(client, guild) {
    const sql = client.sql;

    // 1. جلب القناة والإعدادات
    const settings = sql.prepare("SELECT * FROM settings WHERE guild = ?").get(guild.id);
    if (!settings || !settings.dropGiveawayChannelID) {
        return false; // لم يتم تعيين القناة
    }
    const channel = guild.channels.cache.get(settings.dropGiveawayChannelID);
    if (!channel) {
        return false; // القناة غير موجودة
    }

    const DEFAULTS = {
        dropTitle: "🎉 قيفاواي مفاجئ! 🎉",
        dropDescription: "تفاعلكم رائع! إليكم قيفاواي سريع:\n\n✦ الـجـائـزة: **{prize}**\n✦ الـفـائـزون: `{winners}`\n✦ ينتهي بعـد: {time}",
        dropColor: "Gold",
        dropFooter: "اضغط الزر للدخول!",
        dropButtonLabel: "ادخل السحب!",
        dropButtonEmoji: "🎁",
        dropMessageContent: "✨ **قيفاواي مفاجئ ظهر!** ✨"
    };

    const moraReward = Math.floor(Math.random() * 4001) + 1000; 
    const xpReward = Math.floor(Math.random() * 4001) + 1000;   
    const winnerCount = Math.floor(Math.random() * 3) + 1;       
    const durationMs = 5 * 60 * 1000; 
    const endsAt = Date.now() + durationMs;
    const endsAtTimestamp = Math.floor(endsAt / 1000);

    const prize = `🎁 \`${moraReward.toLocaleString()}\` مورا و \`${xpReward.toLocaleString()}\` اكس بي`;

    const title = settings.dropTitle || DEFAULTS.dropTitle;
    const descriptionTemplate = settings.dropDescription || DEFAULTS.dropDescription;
    const description = descriptionTemplate
        .replace(/{prize}/g, prize)
        .replace(/{winners}/g, winnerCount)
        .replace(/{time}/g, `<t:${endsAtTimestamp}:R>`);

    const color = settings.dropColor || DEFAULTS.dropColor;
    const footer = settings.dropFooter || DEFAULTS.dropFooter;
    const buttonLabel = settings.dropButtonLabel || DEFAULTS.dropButtonLabel;
    const buttonEmoji = settings.dropButtonEmoji || DEFAULTS.dropButtonEmoji;
    const content = settings.dropMessageContent || DEFAULTS.dropMessageContent;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: footer });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_join') // استخدام نفس ID الزر الموحد
            .setLabel(buttonLabel)
            .setStyle(ButtonStyle.Success)
            .setEmoji(buttonEmoji)
    );

    const message = await channel.send({ 
        content: content,
        embeds: [embed], 
        components: [row] 
    });

    sql.prepare(
        "INSERT INTO active_giveaways (messageID, guildID, channelID, prize, endsAt, winnerCount, xpReward, moraReward, isFinished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
    ).run(message.id, guild.id, channel.id, prize, endsAt, winnerCount, xpReward, moraReward);

    setTimeout(() => {
        endGiveaway(client, message.id); 
    }, durationMs); 

    return true; 
}

// دالة التهيئة عند التشغيل (لاستعادة القيف اواي)
async function initGiveaways(client) {
    const sql = client.sql;
    console.log("🔄 [Giveaways] Checking for active giveaways...");
    
    const activeGiveaways = sql.prepare("SELECT * FROM active_giveaways WHERE isFinished = 0").all();
    
    for (const giveaway of activeGiveaways) {
        const now = Date.now();
        const timeLeft = giveaway.endsAt - now;

        if (timeLeft <= 0) {
            console.log(`[Giveaway] Ending expired giveaway: ${giveaway.messageID}`);
            endGiveaway(client, giveaway.messageID);
        } else {
            console.log(`[Giveaway] Rescheduling giveaway: ${giveaway.messageID} (ends in ${Math.floor(timeLeft/1000)}s)`);
            setTimeout(() => {
                endGiveaway(client, giveaway.messageID);
            }, timeLeft);
        }
    }
}

module.exports = {
    getUserWeight,
    startGiveaway,
    handleJoin,
    endGiveaway,
    rerollGiveaway,
    createRandomDropGiveaway,
    initGiveaways
};
