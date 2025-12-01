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

module.exports = (client, _ignoredSql, _ignoredCache) => { // (نتجاهل المتغيرات القديمة)

    client.on(Events.InteractionCreate, async i => {
        
        // ( 🌟 التصحيح الجوهري: نستخدم النسخة الحالية من sql الموجودة في client دائماً 🌟 )
        const sql = client.sql; 
        const antiRolesCache = client.antiRolesCache;

        // فحص أمان لقاعدة البيانات
        if (!sql || !sql.open) {
             if (!i.replied && !i.deferred) {
                 return i.reply({ content: "⚠️ قاعدة البيانات يتم تحديثها حالياً، الرجاء الانتظار...", ephemeral: true }).catch(() => {});
             }
             return;
        }

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
                    await i.reply({ content: 'حدث خطأ، هذا الأمر غير موجود.', ephemeral: true });
                    return; 
                }
                try {
                    await command.execute(i); 
                } catch (error) {
                    console.error(`[Slash Error]`, error);
                    if (!i.replied && !i.deferred) await i.reply({ content: 'حدث خطأ!', ephemeral: true });
                }
                return; 
            }

            // --- 2. الإكمال التلقائي ---
            if (i.isAutocomplete()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) return;
                try { if (command.autocomplete) await command.autocomplete(i); } catch (error) {}
                return; 
            }

            // --- 3. الكونتكس منيو ---
            if (i.isContextMenuCommand()) {
                const command = i.client.commands.get(i.commandName);
                if (!command) return;
                try { await command.execute(i); } catch (error) {}
                return; 
            }

            // --- 4. الأزرار (Buttons) ---
            if (i.isButton()) {
                const id = i.customId;

                if (id.startsWith('customrole_')) {
                    await handleCustomRoleInteraction(i, client, sql);
                }
                else if (
                    id.startsWith('buy_') || id.startsWith('upgrade_') || id.startsWith('shop_') || 
                    id.startsWith('replace_buff_') || id === 'cancel_purchase' || id === 'open_xp_modal' ||
                    id === 'max_level' || id === 'max_rod'
                ) {
                    await handleShopInteractions(i, client, sql);
                }
                else if (id === 'g_builder_content') {
                    const data = giveawayBuilders.get(i.user.id) || {};
                    const modal = new ModalBuilder().setCustomId('g_content_modal').setTitle('إعداد المحتوى');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_prize').setLabel('الجائزة').setStyle(TextInputStyle.Short).setValue(data.prize || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_duration').setLabel('المدة').setPlaceholder("1d 5h").setStyle(TextInputStyle.Short).setValue(data.durationStr || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_winners').setLabel('الفائزين').setPlaceholder("1").setStyle(TextInputStyle.Short).setValue(data.winnerCountStr || '').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_rewards').setLabel('مكافآت').setPlaceholder("XP: 100").setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_channel').setLabel('القناة').setPlaceholder("ID").setStyle(TextInputStyle.Short).setRequired(false))
                    );
                    await i.showModal(modal);
                } else if (id === 'g_builder_visuals') {
                     const data = giveawayBuilders.get(i.user.id) || {};
                    const modal = new ModalBuilder().setCustomId('g_visuals_modal').setTitle('إعداد الشكل');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_desc').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setValue(data.description || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_image').setLabel('صورة').setStyle(TextInputStyle.Short).setValue(data.image || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_color').setLabel('لون').setStyle(TextInputStyle.Short).setValue(data.color || '').setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('g_emoji').setLabel('ايموجي').setStyle(TextInputStyle.Short).setValue(data.buttonEmoji || '').setRequired(false))
                    );
                    await i.showModal(modal);
                } else if (id === 'g_builder_send') {
                     await i.deferReply({ ephemeral: true });
                    const data = giveawayBuilders.get(i.user.id);
                    if (!data || !data.prize) return i.editReply("❌ بيانات ناقصة.");
                    const durationMs = ms(data.durationStr);
                    const endsAt = Date.now() + durationMs;
                    const embed = new EmbedBuilder().setTitle(`✥ قـيـفـاواي: ${data.prize}`).setDescription(`ينتهي: <t:${Math.floor(endsAt/1000)}:R>`).setColor(data.color||"Random").setImage(data.image||null);
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('g_enter').setLabel('مشاركة').setStyle(ButtonStyle.Success).setEmoji(data.buttonEmoji||'🎉'));
                    let ch = i.channel; if(data.channelID) try { ch = await client.channels.fetch(data.channelID); } catch(e){}
                    const msg = await ch.send({ embeds: [embed], components: [row] });
                    sql.prepare("INSERT INTO active_giveaways (messageID, guildID, channelID, prize, endsAt, winnerCount, xpReward, moraReward, isFinished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)").run(msg.id, i.guild.id, ch.id, data.prize, endsAt, parseInt(data.winnerCountStr), data.xpReward||0, data.moraReward||0);
                    setTimeout(() => endGiveaway(client, msg.id), durationMs);
                    giveawayBuilders.delete(i.user.id);
                    await i.editReply("✅ تم الإرسال.");
                } else if (id === 'g_enter') {
                     const entry = sql.prepare("SELECT * FROM giveaway_entries WHERE giveawayID = ? AND userID = ?").get(i.message.id, i.user.id);
                     if(entry) {
                        sql.prepare("DELETE FROM giveaway_entries WHERE giveawayID = ? AND userID = ?").run(i.message.id, i.user.id);
                        await i.reply({content: "✅ ألغيت المشاركة.", ephemeral: true});
                     } else {
                        const w = await getUserWeight(i.member, sql);
                        sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)").run(i.message.id, i.user.id, w);
                        await i.reply({content: `✅ شاركت بوزن ${w}`, ephemeral: true});
                     }
                } else if (id === 'g_enter_drop') {
                     try {
                        const w = await getUserWeight(i.member, sql);
                        sql.prepare("INSERT INTO giveaway_entries (giveawayID, userID, weight) VALUES (?, ?, ?)").run(i.message.id, i.user.id, w);
                        await i.reply({content: `✅ شاركت بوزن ${w}`, ephemeral: true});
                    } catch(e) { await i.reply({content: "⚠️ شاركت مسبقاً.", ephemeral: true}); }
                }
                return; 
            }

            // --- 5. المودالات ---
            if (i.isModalSubmit()) {
                if (i.customId === 'g_content_modal' || i.customId === 'g_visuals_modal') {
                    await i.deferUpdate();
                    const data = giveawayBuilders.get(i.user.id) || {};
                    if (i.customId === 'g_content_modal') {
                        data.prize = i.fields.getTextInputValue('g_prize');
                        data.durationStr = i.fields.getTextInputValue('g_duration');
                        data.winnerCountStr = i.fields.getTextInputValue('g_winners');
                        data.rewardsInput = i.fields.getTextInputValue('g_rewards');
                        data.channelID = i.fields.getTextInputValue('g_channel');
                         let xpReward = 0, moraReward = 0;
                        const rewardParts = (data.rewardsInput||'').split('|');
                        for (const part of rewardParts) {
                            if (part.toLowerCase().includes('xp:')) xpReward = parseInt(part.split(':')[1])||0;
                            if (part.toLowerCase().includes('mora:')) moraReward = parseInt(part.split(':')[1])||0;
                        }
                        data.xpReward = xpReward; data.moraReward = moraReward;
                    } else {
                        data.description = i.fields.getTextInputValue('g_desc');
                        data.image = i.fields.getTextInputValue('g_image');
                        data.color = i.fields.getTextInputValue('g_color');
                        data.buttonEmoji = i.fields.getTextInputValue('g_emoji');
                    }
                    giveawayBuilders.set(i.user.id, data);
                    await updateBuilderEmbed(i, data);
                }
                else if (await handleShopModal(i, client, sql)) { return; }
                else if (i.customId.startsWith('customrole_modal_')) { await handleCustomRoleInteraction(i, client, sql); }
                return; 
            }

            // --- 6. القوائم المنسدلة ---
            if (i.isStringSelectMenu()) {
                if (i.customId.startsWith('rr_')) { 
                    // ( 🌟 استخدام antiRolesCache من client مباشرة 🌟 )
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
            if (!i.replied && !i.deferred) await i.reply({ content: '❌ حدث خطأ.', ephemeral: true }).catch(() => {});
        } finally {
            processingInteractions.delete(i.user.id);
        }
    });
};
