const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, Colors, ComponentType, SlashCommandBuilder } = require("discord.js");
const farmAnimals = require('../../json/farm-animals.json');

const EMOJI_MORA = '<:mora:1435647151349698621>';
const ITEMS_PER_PAGE = 9;

// --- دوال بناء الواجهة (نفس المنطق السابق مع تحسينات بسيطة) ---

function buildGridView(allItems, pageIndex) {
    const startIndex = pageIndex * ITEMS_PER_PAGE;
    const itemsOnPage = allItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    const totalPages = Math.ceil(allItems.length / ITEMS_PER_PAGE);

    const col1 = [], col2 = [], col3 = [];
    itemsOnPage.forEach((item, index) => {
        const price = item.price.toLocaleString();
        const itemLine = `**${item.emoji} ${item.name}**\n${price} ${EMOJI_MORA}`;

        if (index % 3 === 0) col1.push(itemLine);
        else if (index % 3 === 1) col2.push(itemLine);
        else col3.push(itemLine);
    });

    const embed = new EmbedBuilder()
        .setTitle('🏞️ متجر المزرعة')
        .setColor("Random")
        .setImage('https://i.postimg.cc/J0x0Fj0D/download.gif')
        .setDescription('اختر حيواناً من القائمة المنسدلة لعرض التفاصيل والشراء.')
        .addFields(
            { name: '\u200B', value: col1.join('\n\n') || '\u200B', inline: true },
            { name: '\u200B', value: col2.join('\n\n') || '\u200B', inline: true },
            { name: '\u200B', value: col3.join('\n\n') || '\u200B', inline: true }
        )
        .setFooter({ text: `صفحة ${pageIndex + 1}/${totalPages}` });

    const selectOptions = itemsOnPage.map(item => ({
        label: `${item.name}`,
        description: `الدخل اليومي: ${item.income_per_day} مورا`,
        value: item.id,
        emoji: item.emoji
    }));

    const selectMenuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('farm_select_item')
            .setPlaceholder('اختر حيواناً لعرض التفاصيل والشراء...')
            .addOptions(selectOptions)
    );

    return { embed, components: [selectMenuRow] };
}

function buildDetailView(item, userId, guildId, sql, itemIndex, totalItems) {
    const userFarm = sql.prepare("SELECT COUNT(*) as quantity FROM user_farm WHERE userID = ? AND guildID = ? AND animalID = ?").get(userId, guildId, item.id);
    const userQuantity = userFarm ? userFarm.quantity : 0;
    const price = item.price.toLocaleString();
    const income_per_day = item.income_per_day || 0;
    const lifespan = item.lifespan_days || 30;
    const income = (income_per_day * userQuantity).toLocaleString();

    const detailEmbed = new EmbedBuilder()
        .setTitle(`🏞️ ${item.name}`)
        .setColor("Random")
        .setThumbnail(item.image || null)
        .addFields(
            { name: 'سعر الشراء', value: `${price} ${EMOJI_MORA}`, inline: true },
            { name: 'الدخل (لليوم)', value: `${income_per_day} ${EMOJI_MORA}`, inline: true },
            { name: 'العمر الافتراضي', value: `${lifespan} يوم`, inline: true },
            { name: 'في مزرعتك', value: `**${userQuantity.toLocaleString()}** (إجمالي الدخل: ${income}/يوم)`, inline: false }
        )
        .setFooter({ text: `الحيوان ${itemIndex + 1} من ${totalItems}` });

    const actionRow1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`farm_prev_detail_${item.id}`).setLabel('◀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`farm_next_detail_${item.id}`).setLabel('▶️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('farm_back_to_grid').setLabel('العودة للمتجر').setStyle(ButtonStyle.Primary)
    );

    const actionRow2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`buy_animal_${item.id}`).setLabel('شراء').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sell_animal_${item.id}`).setLabel(`بيع (تملك: ${userQuantity})`).setStyle(ButtonStyle.Danger).setDisabled(userQuantity === 0)
    );

    return { embed: detailEmbed, components: [actionRow1, actionRow2] };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('مزرعة')
        .setDescription('يعرض متجر المزرعة لشراء الحيوانات.'),

    name: 'farm',
    aliases: ['المزرعة', 'مزرعه','مزرعة', 'حيوانات'],
    category: "Economy",
    description: 'يعرض متجر المزرعة لشراء الحيوانات.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, client, sql, user, guild;

        if (isSlash) {
            interaction = interactionOrMessage;
            client = interaction.client;
            sql = client.sql;
            user = interaction.user;
            guild = interaction.guild;
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            client = message.client;
            sql = client.sql;
            user = message.author;
            guild = message.guild;
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.channel.send(payload);
            }
        };

        const allItems = farmAnimals;
        if (allItems.length === 0) {
            const embed = new EmbedBuilder().setTitle('🏞️ متجر المزرعة').setDescription("المتجر فارغ حالياً.").setColor(Colors.Red);
            return reply({ embeds: [embed] });
        }

        let currentPage = 0;
        let currentView = 'grid'; // 'grid' or 'detail'
        let currentItemIndex = 0;

        const { embed, components } = buildGridView(allItems, currentPage);

        const msg = await reply({ embeds: [embed], components: components, fetchReply: true });

        const filter = i => i.user.id === user.id;
        const collector = msg.createMessageComponentCollector({
            time: 180000,
            filter,
        });

        collector.on('collect', async i => {
            // 🔥 حماية: إذا تم الرد على التفاعل مسبقاً (من الهاندلر العام مثلاً)، نتوقف
            if (i.replied || i.deferred) return;

            try {
                // ========================================================
                // 1. التعامل مع القائمة المنسدلة (Select Menu)
                // ========================================================
                if (i.isStringSelectMenu() && i.customId === 'farm_select_item') {
                    await i.deferUpdate();
                    currentView = 'detail';
                    const selectedID = i.values[0];
                    const item = allItems.find(it => it.id === selectedID);
                    if (item) {
                        currentItemIndex = allItems.findIndex(it => it.id === selectedID);
                        const { embed: detailEmbed, components: detailComponents } = buildDetailView(item, i.user.id, i.guild.id, sql, currentItemIndex, allItems.length);
                        await i.editReply({ embeds: [detailEmbed], components: detailComponents });
                    }
                }
                
                // ========================================================
                // 2. التعامل مع الأزرار (Buttons)
                // ========================================================
                else if (i.isButton()) {

                    // A. أزرار التنقل (السابق/التالي)
                    if (i.customId.startsWith('farm_prev_detail_') || i.customId.startsWith('farm_next_detail_')) {
                        await i.deferUpdate();

                        const currentItemID = i.customId.split('_')[3];
                        currentItemIndex = allItems.findIndex(it => it.id === currentItemID);

                        if (currentItemIndex === -1) currentItemIndex = 0; // حماية

                        if (i.customId.startsWith('farm_next_detail_')) {
                            currentItemIndex = (currentItemIndex + 1) % allItems.length;
                        } else {
                            currentItemIndex = (currentItemIndex - 1 + allItems.length) % allItems.length;
                        }

                        const item = allItems[currentItemIndex];
                        const { embed: detailEmbed, components: detailComponents } = buildDetailView(item, i.user.id, i.guild.id, sql, currentItemIndex, allItems.length);
                        await i.editReply({ embeds: [detailEmbed], components: detailComponents });
                    }

                    // B. زر العودة للمتجر
                    else if (i.customId === 'farm_back_to_grid') {
                        await i.deferUpdate();
                        currentView = 'grid';
                        const { embed: gridEmbed, components: gridComponents } = buildGridView(allItems, currentPage);
                        await i.editReply({ embeds: [gridEmbed], components: gridComponents });
                    }

                    // C. أزرار الشراء والبيع (المودال)
                    else if (i.customId.startsWith('buy_animal_') || i.customId.startsWith('sell_animal_')) {
                        const isBuy = i.customId.startsWith('buy_animal_');
                        const assetId = i.customId.replace(isBuy ? 'buy_animal_' : 'sell_animal_', '');
                        const item = allItems.find(it => it.id === assetId);

                        if (!item) return;

                        const modal = new ModalBuilder()
                            .setCustomId(`${isBuy ? 'buy_animal_' : 'sell_animal_'}${assetId}`)
                            .setTitle(isBuy ? "شراء حيوان" : "بيع حيوان");

                        const quantityInput = new TextInputBuilder()
                            .setCustomId('quantity_input')
                            .setLabel(isBuy ? `الكمية (سعر الواحد: ${item.price})` : `كمية البيع (لديك في المزرعة)`)
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('أدخل رقماً (مثلاً: 1)')
                            .setMinLength(1)
                            .setMaxLength(5)
                            .setRequired(true);

                        modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
                        
                        // 🔥 عرض المودال (يجب أن يكون الاستجابة الأولى)
                        // نستخدم catch لمنع الكراش إذا سبقه هاندلر آخر
                        await i.showModal(modal).catch(err => {
                            if (err.code !== 40060 && err.code !== 10062) {
                                console.error("Modal Error:", err);
                            }
                        });
                    }
                }

            } catch (error) {
                console.error("Farm Collector Error:", error);
                // محاولة إرسال رسالة خطأ خفية فقط إذا لم نقم بالرد بعد
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: '❌ حدث خطأ غير متوقع.', ephemeral: true }).catch(() => {});
                }
            }
        });

        collector.on('end', () => {
            if (msg.editable) {
                msg.edit({ components: [] }).catch(() => null);
            }
        });
    }
};
