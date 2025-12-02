const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { handleQuestPanel } = require('./handlers/quest-panel-handler.js');
const { handleStreakPanel } = require('./handlers/streak-panel-handler.js');
const { handleShopInteractions, handleShopModal, handleShopSelectMenu, handleSkillSelectMenu } = require('./handlers/shop-handler.js');
const { handlePvpInteraction } = require('./handlers/pvp-handler.js');
const { getUserWeight, endGiveaway, createRandomDropGiveaway } = require('./handlers/giveaway-handler.js');
const { handleReroll } = require('./handlers/reroll-handler.js'); 
const { handleCustomRoleInteraction } = require('./handlers/custom-role-handler.js'); 
const { handleReactionRole } = require('./handlers/reaction-role-handler.js'); 
const ms = require('ms');

const processingInteractions = new Set();
const giveawayBuilders = new Map(); 

async function updateBuilderEmbed(interaction, data) {
    const embed = new EmbedBuilder()
        .setTitle("✥ لوحة إنشاء قيفاواي ✥")
        .setDescription("تم تحديث البيانات. اضغط إرسال عندما تكون جاهزاً.")
        .setColor(data.color || "Grey")
        .addFields([
            { name: "الجائزة (*)", value: data.prize || "لم تحدد", inline: true },
            { name: "المدة (*)", value: data.durationStr || "لم تحدد", inline: true },
            { name: "الفائزون (*)", value: data.winnerCountStr || "لم تحدد", inline: true },
            { name: "الوصف", value: data.description ? "تم التحديد" : "لم يحدد", inline: true },
            { name: "القناة", value: data.channelID ? `<#${data.channelID}>` : "القناة الحالية", inline: true },
            { name: "المكافآت", value: (data.xpReward || data.moraReward) ? "تم التحديد" : "لا يوجد", inline: true },
        ]);

    const isReady = data.prize && data.durationStr && data.winnerCountStr;

    const row = new ActionRowBuilder().addComponents(
        interaction.message.components[0].components[0], 
        interaction.message.components[0].components[1], 
        new ButtonBuilder()
            .setCustomId('g_builder_send')
            .setLabel('إرسال القيفاواي')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!isReady) 
    );

    await interaction.message.edit({ embeds: [embed], components: [row] });
}


// ( 🌟 تم إضافة antiRolesCache هنا 🌟 )
module.exports = (client, sql, antiRolesCache) => {

    client.on(Events.InteractionCreate, async i => {

        console.log(`[Interaction] Received: ${i.type}, ID: ${i.customId || i.commandName}`);

        if (processingInteractions.has(i.user.id)) {
            return i.reply({ content: '⏳ | الرجاء الانتظار، طلبك السابق قيد المعالج...', ephemeral: true }).catch(() => {});
        }

        if (i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) {
             processingInteractions.add(i.user.id);
        }

        try {

            // --- 1. أوامر السلاش ---
            if (i.isChatInputCommand()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) {
                    console.error(`[Slash] لم يتم العثور على أمر يطابق ${i.commandName}`);
                    await i.reply({ content: 'حدث خطأ، هذا الأمر غير موجود.', ephemeral: true });
                    return; 
                }
                try {
                    await command.execute(i); 
                } catch (error) {
                    console.error(`[Error Executing Slash Command: ${i.commandName}]`, error);
                    if (i.replied || i.deferred) {
                        await i.followUp({ content: 'حدث خطأ أثناء تنفيذ هذا الأمر!', ephemeral: true });
                    } else {
                        await i.reply({ content: 'حدث خطأ أثناء تنفيذ هذا الأمر!', ephemeral: true });
                    }
                }
                return; 
            }

            // --- 2. الإكمال التلقائي (Autocomplete) ---
            if (i.isAutocomplete()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) return;
                try {
                    if (command.autocomplete) {
                        await command.autocomplete(i);
                    }
                } catch (error) {
                    console.error(`[Autocomplete Error: ${i.commandName}]`, error);
                }
                return; 
            }

            // --- 3. أوامر الكونتكس منيو (مثل "تقديم بلاغ") ---
            if (i.isContextMenuCommand()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) return;
                try {
                    await command.execute(i);
                } catch (error) {
                    console.error(`[Error Executing Context Menu: ${i.commandName}]`, error);
                    if (i.replied || i.deferred) {
                        await i.followUp({ content: 'حدث خطأ أثناء تنفيذ هذا الأمر!', ephemeral: true });
                    } else {
                        await i.reply({ content: 'حدث خطأ أثناء تنفيذ هذا الأمر!', ephemeral: true });
                    }
                }
                return; 
            }

            // --- 4. الأزرار ---
            if (i.isButton()) {
                if (i.customId === 'g_builder_content') {
                    const data = giveawayBuilders.get(i.user.id) || {};
                    const modal = new ModalBuilder().setCustomId('g_content_modal').setTitle('إعداد المحتوى (1/2)');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_prize').setLabel('الجائزة (إجباري)').setStyle(TextInputStyle.Short).setValue(data.prize || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_duration').setLabel('المدة (إجباري)').setPlaceholder("1d 5h 10m").setStyle(TextInputStyle.Short).setValue(data.durationStr || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_winners').setLabel('عدد الفائزين (إجباري)').setPlaceholder("1").setStyle(TextInputStyle.Short).setValue(data.winnerCountStr || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_rewards').setLabel('المكافآت (اختياري)').setPlaceholder("XP: 100 | Mora: 500").setStyle(TextInputStyle.Short).setValue(data.rewardsInput || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_channel').setLabel('اي دي القناة (اختياري)').setPlaceholder("12345... (اتركه فارغاً للإرسال هنا)").setStyle(TextInputStyle.Short).setValue(data.channelID || '').setRequired(false))
                    );
                    await i.showModal(modal);

                } else if (i.customId === 'g_builder_visuals') {
                    const data = giveawayBuilders.get(i.user.id) || {};
                    const modal = new ModalBuilder().setCustomId('g_visuals_modal').setTitle('إعداد الشكل (2/2)');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_desc').setLabel('الوصف (اختياري)').setStyle(TextInputStyle.Paragraph).setValue(data.description || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_image').setLabel('رابط الصورة (اختياري)').setStyle(TextInputStyle.Short).setValue(data.image || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_color').setLabel('اللون (اختياري)').setPlaceholder("#FFFFFF").setStyle(TextInputStyle.Short).setValue(data.color || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_emoji').setLabel('ايموجي الزر (اختياري)').setPlaceholder("🎉").setStyle(TextInputStyle.Short).setValue(data.buttonEmoji || '').setRequired(false))
                    );
                    await i.showModal(modal);

                } else if (i.customId === 'g_builder_send') {
                    await i.deferReply({ ephemeral: true });
                    const data = giveawayBuilders.get(i.user.id);
                    if (!data || !data.prize || !data.durationStr || !data.winnerCountStr) {
                        return i.editReply("❌ البيانات الأساسية (الجائزة، المدة، الفائزون) مفقودة.");
                    }
                    const durationMs = ms(data.durationStr);
                    const winnerCount = parseInt(data.winnerCountStr);
                    if (!durationMs || durationMs <= 0) return i.editReply("❌ المدة غير صالحة.");
                    if (isNaN(winnerCount) || winnerCount < 1) return i.editReply("❌ عدد الفائزين غير صالح.");
                    const endsAt = Date.now() + durationMs;
                    const endsAtTimestamp = Math.floor(endsAt / 1000);
                    let embedDescription = "";
                    if (data.description) embedDescription += `${data.description}\n\n`;
                    embedDescription += `✶ عـدد الـمـشاركـيـن: \`0\`\n`;
                    embedDescription += `✦ ينتهي بعـد: <t:${endsAtTimestamp}:R>`;
                    const embed = new EmbedBuilder()
                        .setTitle(`✥ قـيـفـاواي عـلـى: ${data.prize}`)
                        .setDescription(embedDescription)
                        .setColor(data.color || "Random")
                        .setImage(data.image || null)
                        .setFooter({ text: `${winnerCount} فائز` });
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('g_enter').setLabel('مـشـاركــة').setStyle(ButtonStyle.Success).setEmoji(data.buttonEmoji || '🎉')
                    );
                    let targetChannel = i.channel;
                    if (data.channelID) {
                        try {
                            targetChannel = await client.channels.fetch(data.channelID);
                            if (!targetChannel || !targetChannel.isTextBased()) throw new Error();
                        } catch (err) {
                            await i.editReply("⚠️ اي دي القناة غير صالح، سيتم الإرسال هنا.");
                            targetChannel = i.channel;
                        }
                    }
                    const gMessage = await targetChannel.send({ embeds: [embed], components: [row] });
                    sql.prepare("INSERT INTO active_giveaways (messageID, guildID, channelID, prize, endsAt, winnerCount, xpReward, moraReward, isFinished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)")
                        .run(gMessage.id, i.guild.id, targetChannel.id, data.prize, endsAt, winnerCount, data.xpReward || 0, data.moraReward || 0);
                    setTimeout(() => endGiveaway(client, gMessage.id), durationMs);
                    giveawayBuilders.delete(i.user.id); 
                    await i.message.edit({ content: "✅ تم إرسال القيفاواي بنجاح!", embeds: [], components: [] });
                    await i.editReply("✅ تم الإرسال!");
                    return;

                } else if (i.customId === 'g_enter') {
                    const giveawayID = i.message.id;
                    const userID = i.user.id;
                    const getEntry = sql.prepare("SELECT * FROM giveaway_entries WHERE giveawayID = ? AND userID = ?");
                    const existingEntry = getEntry.get(giveawayID, userID);
                    let replyMessage = "";
                    if (existingEntry) {
                        sql.prepare("DELETE FROM giveaway_entries WHERE giveawayID = ? AND userID = ?").run(giveawayID, userID);
                        replyMessage = "✅ تـم الـغـاء الـمـشاركـة";
                    } else {
                        const weight = await getUserWeight(i.member, sql);
                        sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)")
                            .run(giveawayID, userID, weight);
                        replyMessage = `✅ تـمـت الـمـشاركـة بنـجـاح دخـلت بـ: ${weight} تذكـرة`;
                    }
                    const entryCount = sql.prepare("SELECT COUNT(*) as count FROM giveaway_entries WHERE giveawayID = ?").get(giveawayID);
                    const newEmbed = new EmbedBuilder(i.message.embeds[0].toJSON());
                    const oldDesc = newEmbed.data.description;
                    const descRegex = /✶ عـدد الـمـشاركـيـن: `\d+`/i;
                    const newDesc = oldDesc.replace(descRegex, `✶ عـدد الـمـشاركـيـن: \`${entryCount.count}\``);
                    newEmbed.setDescription(newDesc);
                    await i.message.edit({ embeds: [newEmbed] });
                    await i.reply({ content: replyMessage, ephemeral: true });

                } else if (i.customId === 'g_enter_drop') {
                    const messageID = i.message.id;
                    const member = i.member;
                    try {
                        const giveaway = sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ? AND isFinished = 0").get(messageID);
                        if (!giveaway || giveaway.endsAt < Date.now()) {
                            return i.reply({ content: "❌ عذراً، هذا القيفاواي المفاجئ انتهى.", ephemeral: true });
                        }
                        const weight = await getUserWeight(member, sql);
                        try {
                            sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)")
                                .run(messageID, member.id, weight);
                            return i.reply({ content: `✅ تم تسجيلك بنجاح بوزن \`${weight}x\`!`, ephemeral: true });
                        } catch (err) {
                            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                                return i.reply({ content: "⚠️ أنت مسجل بالفعل في هذا القيفاواي.", ephemeral: true });
                            }
                            throw err; 
                        }
                    } catch (error) {
                        console.error("[DropGA Enter] خطأ:", error);
                        return i.reply({ content: "❌ حدث خطأ أثناء محاولة التسجيل.", ephemeral: true });
                    }

                } else if (i.customId.startsWith('panel_') || i.customId.startsWith('quests_')) {
                    await handleQuestPanel(i, client, sql);
                } else if (i.customId.startsWith('streak_panel_')) {
                    await handleStreakPanel(i, client, sql);
                } else if (i.customId.startsWith('buy_item_') ||
                    i.customId.startsWith('replace_buff_') ||
                    i.customId === 'cancel_purchase' ||
                    i.customId === 'open_xp_modal' ||
                    i.customId.startsWith('buy_weapon_') ||
                    i.customId.startsWith('upgrade_weapon_') ||
                    i.customId.startsWith('buy_skill_') ||
                    i.customId.startsWith('upgrade_skill_') ||
                    i.customId.startsWith('shop_paginate_item_') ||
                    i.customId.startsWith('shop_skill_paginate_')) {
                    await handleShopInteractions(i, client, sql);
                } else if (i.customId.startsWith('pvp_')) {
                    await handlePvpInteraction(i, client, sql);
                } else if (i.customId.startsWith('customrole_')) { 
                    await handleCustomRoleInteraction(i, client, sql);
                }
                return; 

            // --- 5. المودالات (Pop-ups) ---
            } else if (i.isModalSubmit()) {
                if (i.customId === 'g_content_modal') {
                    await i.deferUpdate();
                    const data = giveawayBuilders.get(i.user.id) || {};
                    const rewardsInput = i.fields.getTextInputValue('g_rewards') || '';
                    data.rewardsInput = rewardsInput; 
                    let xpReward = 0;
                    let moraReward = 0;
                    const rewardParts = rewardsInput.split('|').map(s => s.trim());
                    for (const part of rewardParts) {
                        if (part.toLowerCase().startsWith('xp:')) xpReward = parseInt(part.split(':')[1]) || 0;
                        if (part.toLowerCase().startsWith('mora:')) moraReward = parseInt(part.split(':')[1]) || 0;
                    }
                    data.prize = i.fields.getTextInputValue('g_prize');
                    data.durationStr = i.fields.getTextInputValue('g_duration');
                    data.winnerCountStr = i.fields.getTextInputValue('g_winners');
                    data.channelID = i.fields.getTextInputValue('g_channel') || null;
                    data.xpReward = xpReward;
                    data.moraReward = moraReward;
                    giveawayBuilders.set(i.user.id, data);
                    await updateBuilderEmbed(i, data); 

                } else if (i.customId === 'g_visuals_modal') {
                    await i.deferUpdate();
                    const data = giveawayBuilders.get(i.user.id) || {};
                    data.description = i.fields.getTextInputValue('g_desc') || null;
                    data.image = i.fields.getTextInputValue('g_image') || null;
                    data.color = i.fields.getTextInputValue('g_color') || null;
                    data.buttonEmoji = i.fields.getTextInputValue('g_emoji') || null;
                    giveawayBuilders.set(i.user.id, data);
                    await updateBuilderEmbed(i, data); 
                }

                else if (await handleShopModal(i, client, sql)) {
                    // (تمت المعالجة)
                } else if (i.customId.startsWith('customrole_modal_')) { 
                    await handleCustomRoleInteraction(i, client, sql);
                }
                return; 

            // --- 6. القوائم المنسدلة ---
            } else if (i.isStringSelectMenu()) {
                if (i.customId.startsWith('rr_')) { 
                    // ( 🌟 تم تمرير antiRolesCache هنا 🌟 )
                    await handleReactionRole(i, client, sql, antiRolesCache); 
                } else if (i.customId === 'g_reroll_select') {
                    await handleReroll(i, client, sql);
                } else if (i.customId.startsWith('quest_panel_menu')) {
                    await handleQuestPanel(i, client, sql);
                } else if (i.customId === 'streak_panel_menu') {
                    await handleStreakPanel(i, client, sql);
                } else if (i.customId === 'shop_select_item') {
                    await handleShopSelectMenu(i, client, sql);
                } else if (i.customId === 'shop_skill_select_menu') {
                    await handleSkillSelectMenu(i, client, sql);
                } else if (i.customId === 'streak_panel_select_sep') {
                    await handleStreakPanel(i, client, sql);
                } else if (i.customId === 'pvp_skill_select') {
                    await handlePvpInteraction(i, client, sql);
                }
                return; 
            }

        } catch (error) {
            console.error("خطأ فادح في معالج التفاعلات:", error);
            if (i.replied || i.deferred) {
                await i.followUp({ content: '❌ حدث خطأ غير متوقع.', ephemeral: true }).catch(console.error);
            } else {
                await i.reply({ content: '❌ حدث خطأ غير متوقع.', ephemeral: true }).catch(console.error);
            }
        } finally {
            processingInteractions.delete(i.user.id);
        }
    });
};
