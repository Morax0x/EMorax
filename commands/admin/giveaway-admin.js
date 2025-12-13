const { PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType } = require("discord.js");
const { startGiveaway } = require('../../handlers/giveaway-handler.js'); // التأكد من المسار الصحيح

// دالة تحويل النص (10m, 1h) إلى ميلي ثانية
function parseDuration(durationStr) {
    if (!durationStr) return null;
    const regex = /(\d+)\s*([smhd])/i;
    const match = durationStr.match(regex);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('قيفاواي')
        .setDescription('إرسال لوحة تحكم إنشاء قيفاواي جديد.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

    name: 'giveaway',
    aliases: ['g-admin', 'قيف'],
    category: "Admin",
    description: 'إرسال لوحة تحكم إنشاء قيفاواي جديد.',

    async execute(interactionOrMessage, args) {
        let interaction, message, member, channel;
        const isSlash = !!interactionOrMessage.isChatInputCommand;

        if (isSlash) {
            interaction = interactionOrMessage;
            member = interaction.member;
            channel = interaction.channel;
            // استخدام deferReply لأن التجميع قد يستغرق وقتاً
            await interaction.deferReply({ ephemeral: true }); 
        } else {
            message = interactionOrMessage;
            member = message.member;
            channel = message.channel;
        }

        const reply = async (payload) => {
            if (isSlash) return interaction.editReply(payload);
            return message.channel.send(payload);
        };

        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return reply({ content: "❌ ليس لديك صلاحيات.", ephemeral: true });
        }

        // بيانات القيف اواي المؤقتة
        let giveawayData = {
            prize: null,
            durationRaw: null,
            durationMs: null,
            winnerCount: 1,
            description: null,
            targetChannel: channel,
            xpReward: 0,
            moraReward: 0
        };

        const updateEmbed = () => {
            const embed = new EmbedBuilder()
                .setTitle("✥ لوحة إنشاء قيفاواي ✥")
                .setDescription("قم بإدخال البيانات باستخدام الأزرار أدناه. الحقول الإجبارية (*) يجب تعبئتها قبل الإرسال.")
                .setColor("Grey")
                .addFields([
                    { name: "الجائزة (*)", value: giveawayData.prize || "❌ لم تحدد", inline: true },
                    { name: "المدة (*)", value: giveawayData.durationRaw || "❌ لم تحدد", inline: true },
                    { name: "الفائزون (*)", value: `${giveawayData.winnerCount}`, inline: true },
                    { name: "القناة", value: `${giveawayData.targetChannel}`, inline: true },
                    { name: "المكافآت", value: `مورا: ${giveawayData.moraReward} | XP: ${giveawayData.xpReward}`, inline: true },
                ]);
            return embed;
        };

        const getRows = (disabled = false) => {
            const isReady = giveawayData.prize && giveawayData.durationMs;
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('g_builder_content')
                    .setLabel('البيانات الأساسية (1)')
                    .setEmoji('📝')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled),
                new ButtonBuilder()
                    .setCustomId('g_builder_visuals')
                    .setLabel('الإعدادات الإضافية (2)')
                    .setEmoji('⚙️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled),
                new ButtonBuilder()
                    .setCustomId('g_builder_send')
                    .setLabel('إرسال القيفاواي')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(disabled || !isReady) // معطل حتى تكتمل البيانات
            );
        };

        const msg = await reply({
            embeds: [updateEmbed()],
            components: [getRows()],
            fetchReply: true
        });

        // إنشاء جامع للأزرار (يعمل لمدة 5 دقائق)
        const collector = msg.createMessageComponentCollector({ 
            filter: i => i.user.id === member.id, 
            time: 5 * 60 * 1000 
        });

        collector.on('collect', async i => {
            // --- زر البيانات الأساسية ---
            if (i.customId === 'g_builder_content') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_g_content')
                    .setTitle('بيانات القيف اواي الأساسية');

                const prizeInput = new TextInputBuilder()
                    .setCustomId('input_prize')
                    .setLabel("ما هي الجائزة؟")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                
                if(giveawayData.prize) prizeInput.setValue(giveawayData.prize);

                const timeInput = new TextInputBuilder()
                    .setCustomId('input_time')
                    .setLabel("المدة (مثال: 10m, 1h, 2d)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                if(giveawayData.durationRaw) timeInput.setValue(giveawayData.durationRaw);

                const winnersInput = new TextInputBuilder()
                    .setCustomId('input_winners')
                    .setLabel("عدد الفائزين")
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(giveawayData.winnerCount))
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(prizeInput),
                    new ActionRowBuilder().addComponents(timeInput),
                    new ActionRowBuilder().addComponents(winnersInput)
                );

                await i.showModal(modal);

                // انتظار تسليم المودال
                try {
                    const submit = await i.awaitModalSubmit({ time: 60000, filter: s => s.user.id === i.user.id });
                    
                    const p = submit.fields.getTextInputValue('input_prize');
                    const t = submit.fields.getTextInputValue('input_time');
                    const w = parseInt(submit.fields.getTextInputValue('input_winners'));

                    const ms = parseDuration(t);
                    if (!ms) {
                        await submit.reply({ content: "❌ صيغة الوقت غير صحيحة. حاول مرة أخرى (مثال: 30m).", ephemeral: true });
                        return;
                    }
                    if (isNaN(w) || w < 1) {
                        await submit.reply({ content: "❌ عدد الفائزين غير صالح.", ephemeral: true });
                        return;
                    }

                    giveawayData.prize = p;
                    giveawayData.durationRaw = t;
                    giveawayData.durationMs = ms;
                    giveawayData.winnerCount = w;

                    await submit.update({ embeds: [updateEmbed()], components: [getRows()] });

                } catch (e) { /* تجاهل انتهاء الوقت */ }
            }

            // --- زر الإعدادات الإضافية ---
            else if (i.customId === 'g_builder_visuals') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_g_visuals')
                    .setTitle('الإعدادات الإضافية (اختياري)');

                const channelInput = new TextInputBuilder()
                    .setCustomId('input_channel')
                    .setLabel("آيدي القناة (اتركه فارغاً للحالية)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                const moraInput = new TextInputBuilder()
                    .setCustomId('input_mora')
                    .setLabel("مكافأة مورا (تلقائي للفائز)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                const xpInput = new TextInputBuilder()
                    .setCustomId('input_xp')
                    .setLabel("مكافأة خبرة (تلقائي للفائز)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(channelInput),
                    new ActionRowBuilder().addComponents(moraInput),
                    new ActionRowBuilder().addComponents(xpInput)
                );

                await i.showModal(modal);

                try {
                    const submit = await i.awaitModalSubmit({ time: 60000, filter: s => s.user.id === i.user.id });
                    
                    const chID = submit.fields.getTextInputValue('input_channel');
                    const m = parseInt(submit.fields.getTextInputValue('input_mora')) || 0;
                    const x = parseInt(submit.fields.getTextInputValue('input_xp')) || 0;

                    if (chID) {
                        const ch = member.guild.channels.cache.get(chID);
                        if (ch) giveawayData.targetChannel = ch;
                        else {
                            await submit.reply({ content: "❌ القناة غير موجودة أو الآيدي خطأ.", ephemeral: true });
                            return;
                        }
                    }

                    giveawayData.moraReward = m;
                    giveawayData.xpReward = x;

                    await submit.update({ embeds: [updateEmbed()], components: [getRows()] });

                } catch (e) { /* تجاهل */ }
            }

            // --- زر الإرسال ---
            else if (i.customId === 'g_builder_send') {
                await i.deferUpdate(); // تأكيد الضغط

                try {
                    // استدعاء دالة البدء من الهاندلر (التي تحفظ في الداتابيس)
                    await startGiveaway(
                        interaction.client,
                        i, // نمرر التفاعل
                        giveawayData.targetChannel, // القناة
                        giveawayData.durationMs, // الوقت
                        giveawayData.winnerCount, // عدد الفائزين
                        giveawayData.prize, // الجائزة
                        giveawayData.xpReward, // XP
                        giveawayData.moraReward // Mora
                    );

                    const successEmbed = new EmbedBuilder()
                        .setColor("Green")
                        .setTitle("✅ تم إرسال القيفاواي")
                        .setDescription(`تم بدء القيفاواي بنجاح في ${giveawayData.targetChannel}!\n\nسيتم حفظه في قاعدة البيانات، ولن يتأثر بإعادة تشغيل البوت.`);

                    await i.editReply({ embeds: [successEmbed], components: [] });
                    collector.stop();

                } catch (error) {
                    console.error(error);
                    await i.followUp({ content: "❌ حدث خطأ أثناء بدء القيفاواي.", ephemeral: true });
                }
            }
        });

        collector.on('end', (c, reason) => {
            if (reason === 'time') {
                msg.edit({ components: [getRows(true)] }).catch(() => {});
            }
        });
    }
};
