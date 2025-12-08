const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, MessageFlags } = require("discord.js");
const { handleQuestPanel } = require('./handlers/quest-panel-handler.js');
const { handleStreakPanel } = require('./handlers/streak-panel-handler.js');
const { handleShopInteractions, handleShopModal, handleShopSelectMenu, handleSkillSelectMenu } = require('./handlers/shop-handler.js');
const { handlePvpInteraction } = require('./handlers/pvp-handler.js'); 
const { getUserWeight, endGiveaway, createRandomDropGiveaway } = require('./handlers/giveaway-handler.js');
const { handleReroll } = require('./handlers/reroll-handler.js'); 
const { handleCustomRoleInteraction } = require('./handlers/custom-role-handler.js'); 
const { handleReactionRole } = require('./handlers/reaction-role-handler.js'); 
const { handleBossInteraction } = require('./handlers/boss-handler.js'); // ✅ استيراد الوحش

// محاولة استيراد المزرعة إذا كانت موجودة
let handleFarmInteractions;
try { ({ handleFarmInteractions } = require('./handlers/farm-handler.js')); } catch(e) {}

const ms = require('ms');

const processingInteractions = new Set();
const giveawayBuilders = new Map(); 

// دالة مساعدة لتحديث إيمبد بناء القيفاواي
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

    let components = interaction.message.components;
    if (!components || components.length === 0) {
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('g_builder_content').setLabel('تعديل المحتوى').setStyle(ButtonStyle.Primary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('g_builder_visuals').setLabel('تعديل الشكل').setStyle(ButtonStyle.Secondary).setEmoji('🎨')
        );
        components = [row1];
    }

    const row = new ActionRowBuilder().addComponents(
        components[0].components[0], 
        components[0].components[1], 
        new ButtonBuilder()
            .setCustomId('g_builder_send')
            .setLabel('إرسال القيفاواي')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!isReady) 
    );

    try {
        await interaction.message.edit({ embeds: [embed], components: [row] });
    } catch (error) {
        if (error.code === 10008) { 
            console.log("[Giveaway Builder] Original message missing.");
            await interaction.followUp({ content: "⚠️ الرسالة الأصلية اختفت. يرجى بدء الأمر من جديد.", flags: [MessageFlags.Ephemeral] });
        } else {
            throw error;
        }
    }
}

module.exports = (client, sql, antiRolesCache) => {

    client.on(Events.InteractionCreate, async i => {

        // التحقق من حالة قاعدة البيانات
        if (!sql.open && !i.isAutocomplete()) {
             if (!i.replied && !i.deferred) {
                 return i.reply({ content: "⚠️ قاعدة البيانات يتم تحديثها حالياً، الرجاء الانتظار...", flags: [MessageFlags.Ephemeral] }).catch(() => {});
             }
             return;
        }

        // منع التكرار السريع (Anti-Spam Click)
        if (processingInteractions.has(i.user.id)) {
            if (!i.isModalSubmit()) {
                 return i.reply({ content: '⏳ | الرجاء الانتظار.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
            }
        }

        if (i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) {
             processingInteractions.add(i.user.id);
        }

        try {

            // ====================================================
            // 1. Slash Commands
            // ====================================================
            if (i.isChatInputCommand()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) {
                    await i.reply({ content: 'حدث خطأ، هذا الأمر غير موجود.', flags: [MessageFlags.Ephemeral] });
                    return; 
                }
                
                let isAllowed = false;
                if (i.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) isAllowed = true;
                else {
                    try {
                        const channelPerm = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? AND channelID = ?").get(i.guild.id, command.name, i.channel.id);
                        const categoryPerm = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? AND channelID = ?").get(i.guild.id, command.name, i.channel.parentId);
                        if (channelPerm || categoryPerm) isAllowed = true;
                        else {
                            const hasRestrictions = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ?").get(i.guild.id, command.name);
                            if (!hasRestrictions) isAllowed = true; 
                        }
                    } catch(e) { isAllowed = true; }
                }

                if (!isAllowed) {
                    return i.reply({ content: "❌ لا يمكنك استخدام هذا الأمر في هذه القناة.", flags: [MessageFlags.Ephemeral] });
                }

                try {
                    await command.execute(i); 
                } catch (error) {
                    console.error(`[Slash Error: ${i.commandName}]`, error);
                    if (i.replied || i.deferred) await i.followUp({ content: 'حدث خطأ!', flags: [MessageFlags.Ephemeral] });
                    else await i.reply({ content: 'حدث خطأ!', flags: [MessageFlags.Ephemeral] });
                }
                return; 
            }

            // ====================================================
            // 2. Autocomplete & Context Menu
            // ====================================================
            if (i.isAutocomplete()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) return;
                try { if (command.autocomplete) await command.autocomplete(i); } catch (e) {}
                return; 
            }

            if (i.isContextMenuCommand()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) return;
                try { await command.execute(i); } catch (e) {}
                return; 
            }

            // ====================================================
            // 3. Buttons Interactions
            // ====================================================
            if (i.isButton()) {
                const id = i.customId;

                // 🆕 FIX: Defer for buttons leading to modals or complex logic (Except Shop/Game Modals)
                if (id === 'g_builder_content' || id === 'g_builder_visuals' || id.startsWith('farm_buy_menu') || id.startsWith('mem_auto_confirm')) {
                    if (!i.replied && !i.deferred) await i.deferUpdate(); 
                }

                // رتب خاصة
                if (id.startsWith('customrole_')) {
                    await handleCustomRoleInteraction(i, client, sql);
                }
                
                // ✅ World Boss Buttons
                else if (id === 'boss_attack' || id === 'boss_status') {
                    await handleBossInteraction(i, client, sql);
                }
                
                // ✅ Farm Buttons
                else if ((id === 'farm_collect' || id === 'farm_buy_menu') && handleFarmInteractions) {
                    await handleFarmInteractions(i, client, sql);
                }

                // ✅ Shop/Fish/Market Buttons
                else if (
                    id.startsWith('buy_') || id.startsWith('upgrade_') || id.startsWith('shop_') || 
                    id.startsWith('replace_') || id === 'cancel_purchase' || id === 'open_xp_modal' ||
                    id === 'max_level' || id === 'max_rod' || id === 'max_boat' ||
                    id === 'cast_rod' || id.startsWith('pull_rod') || 
                    id.startsWith('sell_') || id.startsWith('mem_') || 
                    id === 'replace_guard'
                ) {
                    await handleShopInteractions(i, client, sql);
                }
                 
                // ✅ أزرار بناء القيفاواي (Builder)
                else if (id === 'g_builder_content') {
                    const data = giveawayBuilders.get(i.user.id) || {};
                    const modal = new ModalBuilder().setCustomId('g_content_modal').setTitle('إعداد المحتوى (1/2)');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_prize').setLabel('الجائزة (إجباري)').setStyle(TextInputStyle.Short).setValue(data.prize || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_duration').setLabel('المدة (إجباري)').setPlaceholder("1d 5h 10m").setStyle(TextInputStyle.Short).setValue(data.durationStr || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_winners').setLabel('عدد الفائزين (إجباري)').setPlaceholder("1").setStyle(TextInputStyle.Short).setValue(data.winnerCountStr || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_rewards').setLabel('المكافآت (اختياري)').setPlaceholder("XP: 100 | Mora: 500").setStyle(TextInputStyle.Short).setValue(data.rewardsInput || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_channel').setLabel('اي دي القناة (اختياري)').setPlaceholder("12345...").setStyle(TextInputStyle.Short).setValue(data.channelID || '').setRequired(false))
                    );
                    await i.showModal(modal);

                } else if (id === 'g_builder_visuals') {
                    const data = giveawayBuilders.get(i.user.id) || {};
                    const modal = new ModalBuilder().setCustomId('g_visuals_modal').setTitle('إعداد الشكل (2/2)');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_desc').setLabel('الوصف (اختياري)').setStyle(TextInputStyle.Paragraph).setValue(data.description || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_image').setLabel('رابط الصورة (اختياري)').setStyle(TextInputStyle.Short).setValue(data.image || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_color').setLabel('اللون (اختياري)').setPlaceholder("#FFFFFF").setStyle(TextInputStyle.Short).setValue(data.color || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_emoji').setLabel('ايموجي الزر (اختياري)').setPlaceholder("🎉").setStyle(TextInputStyle.Short).setValue(data.buttonEmoji || '').setRequired(false))
                    );
                    await i.showModal(modal);

                } else if (id === 'g_builder_send') {
                    await i.deferReply({ flags: [MessageFlags.Ephemeral] }); 
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
                            const ch = await client.channels.fetch(data.channelID);
                            if (ch && ch.isTextBased()) targetChannel = ch;
                        } catch (err) { await i.editReply("⚠️ اي دي القناة غير صالح، سيتم الإرسال هنا."); }
                    }
                    
                    const gMessage = await targetChannel.send({ embeds: [embed], components: [row] });
                    
                    sql.prepare("INSERT INTO active_giveaways (messageID, guildID, channelID, prize, endsAt, winnerCount, xpReward, moraReward, isFinished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)")
                        .run(gMessage.id, i.guild.id, targetChannel.id, data.prize, endsAt, winnerCount, data.xpReward || 0, data.moraReward || 0);
                    
                    setTimeout(() => endGiveaway(client, gMessage.id), durationMs);
                    
                    giveawayBuilders.delete(i.user.id); 
                    await i.message.edit({ content: "✅ تم إرسال القيفاواي بنجاح!", embeds: [], components: [] }).catch(() => {});
                    await i.editReply("✅ تم الإرسال!");
                    return;

                } else if (id === 'g_enter') {
                    await i.deferUpdate(); 
                    const giveawayID = i.message.id;
                    const userID = i.user.id;
                    const existingEntry = sql.prepare("SELECT * FROM giveaway_entries WHERE giveawayID = ? AND userID = ?").get(giveawayID, userID);
                    let replyMessage = "";
                    if (existingEntry) {
                        sql.prepare("DELETE FROM giveaway_entries WHERE giveawayID = ? AND userID = ?").run(giveawayID, userID);
                        replyMessage = "✅ تـم الـغـاء الـمـشاركـة";
                    } else {
                        const weight = await getUserWeight(i.member, sql);
                        sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)").run(giveawayID, userID, weight);
                        replyMessage = `✅ تـمـت الـمـشاركـة بنـجـاح دخـلت بـ: ${weight} تذكـرة`;
                    }
                    const entryCount = sql.prepare("SELECT COUNT(*) as count FROM giveaway_entries WHERE giveawayID = ?").get(giveawayID);
                    const newEmbed = new EmbedBuilder(i.message.embeds[0].toJSON());
                    newEmbed.setDescription(newEmbed.data.description.replace(/✶ عـدد الـمـشاركـيـن: `\d+`/i, `✶ عـدد الـمـشاركـيـن: \`${entryCount.count}\``));
                    await i.message.edit({ embeds: [newEmbed] });
                    await i.followUp({ content: replyMessage, flags: [MessageFlags.Ephemeral] }); 
                
                } else if (id === 'g_enter_drop') {
                    await i.deferUpdate(); 
                    const messageID = i.message.id;
                    try {
                        const giveaway = sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ? AND isFinished = 0").get(messageID);
                        if (!giveaway || giveaway.endsAt < Date.now()) return i.followUp({ content: "❌ انتهى.", flags: [MessageFlags.Ephemeral] });
                        const weight = await getUserWeight(i.member, sql);
                        try {
                            sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)").run(messageID, i.member.id, weight);
                            return i.followUp({ content: `✅ تم التسجيل بوزن \`${weight}x\`!`, flags: [MessageFlags.Ephemeral] });
                        } catch (err) { return i.followUp({ content: "⚠️ أنت مسجل بالفعل.", flags: [MessageFlags.Ephemeral] }); }
                    } catch (error) { return i.followUp({ content: "❌ حدث خطأ.", flags: [MessageFlags.Ephemeral] }); }

                } else if (id.startsWith('panel_') || id.startsWith('quests_')) {
                    await handleQuestPanel(i, client, sql);
                } else if (id.startsWith('streak_panel_')) {
                    await handleStreakPanel(i, client, sql);
                } else if (id.startsWith('pvp_')) {
                    await handlePvpInteraction(i, client, sql);
                } else if (id.startsWith('customrole_')) { 
                    await handleCustomRoleInteraction(i, client, sql);
                }
                return; 

            // ====================================================
            // 4. Modals Submissions
            // ====================================================
            } else if (i.isModalSubmit()) {
                if (i.customId === 'g_content_modal') {
                    await i.deferUpdate();
                    const data = giveawayBuilders.get(i.user.id) || {};
                    data.prize = i.fields.getTextInputValue('g_prize');
                    data.durationStr = i.fields.getTextInputValue('g_duration');
                    data.winnerCountStr = i.fields.getTextInputValue('g_winners');
                    data.channelID = i.fields.getTextInputValue('g_channel') || null;
                    const rewardsInput = i.fields.getTextInputValue('g_rewards') || '';
                    data.rewardsInput = rewardsInput;
                    let xpReward = 0, moraReward = 0;
                    rewardsInput.split('|').forEach(p => {
                          if (p.trim().toLowerCase().startsWith('xp:')) xpReward = parseInt(p.split(':')[1]) || 0;
                          if (p.trim().toLowerCase().startsWith('mora:')) moraReward = parseInt(p.split(':')[1]) || 0;
                    });
                    data.xpReward = xpReward; data.moraReward = moraReward;
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
                // ✅ مودال المتجر والخبرة
                else if (await handleShopModal(i, client, sql)) {
                    // Handled
                } else if (i.customId.startsWith('customrole_modal_')) { 
                    await handleCustomRoleInteraction(i, client, sql);
                }
                return; 

            // ====================================================
            // 5. Select Menus
            // ====================================================
            } else if (i.isStringSelectMenu()) {
                
                // ⚠️ (تم الإصلاح): إزالة deferUpdate الإجباري هنا لأنه يسبب مشاكل مع الهاندلرز التي ترد برد جديد
                // نترك لكل هاندلر حرية عمل deferUpdate أو deferReply

                const id = i.customId;
                
                // ✅ قائمة مهارات الوحش
                if (id === 'boss_execute_skill') {
                    await handleBossInteraction(i, client, sql);
                }

                else if (id === 'farm_shop_select' && handleFarmInteractions) {
                    await handleFarmInteractions(i, client, sql);
                }
                
                else if (
                    id === 'shop_select_item' || 
                    id === 'shop_skill_select_menu' || 
                    id === 'fishing_gear_sub_menu' || 
                    id === 'shop_buy_bait_menu'
                ) {
                    // هذه الهاندلرز تتولى الـ defer بنفسها
                    if (id === 'shop_select_item') await handleShopSelectMenu(i, client, sql);
                    else if (id === 'shop_skill_select_menu') await handleSkillSelectMenu(i, client, sql);
                    else await handleShopInteractions(i, client, sql);
                }

                else if (id.startsWith('rr_')) { 
                    await handleReactionRole(i, client, sql, antiRolesCache); 
                } else if (id === 'g_reroll_select') {
                    await handleReroll(i, client, sql);
                } else if (id.startsWith('quest_panel_menu')) {
                    await handleQuestPanel(i, client, sql);
                } else if (id.startsWith('streak_panel_menu')) {
                    await handleStreakPanel(i, client, sql);
                } else if (id.startsWith('pvp_')) { 
                    await handlePvpInteraction(i, client, sql);
                } 

                return; 
            }

        } catch (error) {
            console.error("خطأ فادح في معالج التفاعلات:", error);
            if (!i.replied && !i.deferred) {
                // محاولة أخيرة للرد إذا لم يتم الرد
                await i.reply({ content: '⚠️ انتهى وقت الاستجابة أو حدث خطأ غير متوقع.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
            }
        } finally {
            processingInteractions.delete(i.user.id);
        }
    });
};
