const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, Colors, ComponentType, SlashCommandBuilder } = require("discord.js");
const marketConfig = require('../../json/market-items.json'); // استيراد ملف الإعدادات للفلترة

const EMOJI_MORA = '<:mora:1435647151349698621>';

const EMOJI_ASSET_LARGE = {
    'APPLE': '<:aapple:1435884007484293161>',
    'ANDROID': '<:android:1435885726519656578>',
    'TESLA': '<:tesla:1437395355170771016>',
    'GOLD': '<:gold:1437395402474127382>',
    'LAND': '🏞️',
    'BITCOIN': '<:ss:1437395376738013244>',
    'SPACEX': '🚀',
    'SILVER': '<:pngimg:1437395419544944713>',
    'ART': '<:atr:1437395490168639550>',
};

const EMOJI_ASSET_SMALL = {
    'APPLE': '<:aapple:1435884007484293161>',
    'ANDROID': '<:android:1435885726519656578>',
    'TESLA': '<:tesla:1437395355170771016>',
    'GOLD': '<:gold:1437395402474127382>',
    'LAND': '🏞️',
    'BITCOIN': '<:ss:1437395376738013244>',
    'SPACEX': '🚀',
    'SILVER': '<:pngimg:1437395419544944713>',
    'ART': '<:atr:1437395490168639550>',
};

const EMOJI_ASSET_IMAGES = {
    'TESLA': 'https://i.postimg.cc/Dyp3YSCw/tesla.png',
    'APPLE': 'https://i.postimg.cc/mkQN11tp/Apple-logo-grey-svg.png',
    'GOLD': 'https://i.postimg.cc/gJMPFrY7/gold.png',
    'SPACEX': 'https://i.postimg.cc/7h3PvwQd/spacex-logo-white-png-11735766395eqin6ughzj-removebg-preview.png',
    'ANDROID': 'https://i.postimg.cc/yYytwkvZ/Android-Logo-2014-2019.png',
    'SILVER': 'https://i.postimg.cc/bYHmv4b9/pngimg-com-silver-PNG17188.png',
    'LAND': 'https://i.postimg.cc/bYHmv4b9/pngimg-com-silver-PNG17188.png',
    'BITCOIN': 'https://i.postimg.cc/HWZ732CH/ss.png',
    'ART': 'https://i.postimg.cc/K8Xjspp1/3ecc929e25adc64531f0db7fe65f678f-removebg-preview.png',
};

const EMOJI_UP = '<:upward:1435880367805431850>';
const EMOJI_DOWN = '<:downward:1435880484046372914>';
const EMOJI_NEUTRAL = '<:neutral:1435880568158945292>';

const UPDATE_INTERVAL_MS = 1 * 60 * 60 * 1000;
const ITEMS_PER_PAGE = 9;

function getUpdateTimeRemaining() {
    const now = Date.now();
    const timeSinceStart = now % UPDATE_INTERVAL_MS;
    const remainingTime = UPDATE_INTERVAL_MS - timeSinceStart;
    const totalSeconds = Math.floor(remainingTime / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getItemChangeEmoji(changePercent) {
    if (changePercent > 0.01) return EMOJI_UP;
    if (changePercent < -0.01) return EMOJI_DOWN;
    return EMOJI_NEUTRAL;
}

function cleanEmojiFromName(name) {
    if (!name) return '';
    return name.replace(/<a?:.+?:\d+>/g, '').trim();
}

function buildGridView(allItems, pageIndex, timeRemaining) {
    const startIndex = pageIndex * ITEMS_PER_PAGE;
    const itemsOnPage = allItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    // const totalPages = Math.ceil(allItems.length / ITEMS_PER_PAGE); // (غير مستخدم حالياً لكن مفيد مستقبلاً)

    const col1 = [], col2 = [], col3 = [];
    itemsOnPage.forEach((item, index) => {
        const changeEmoji = getItemChangeEmoji(item.lastChangePercent);
        const assetEmoji = EMOJI_ASSET_LARGE[item.id] || '📈';
        const price = item.currentPrice.toLocaleString();
        const cleanName = cleanEmojiFromName(item.name); 

        const itemLine = `${assetEmoji} **${cleanName.split(' ').slice(0, 2).join(' ')}**\n${price} ${EMOJI_MORA} ${changeEmoji}`;

        if (index % 3 === 0) col1.push(itemLine);
        else if (index % 3 === 1) col2.push(itemLine);
        else col3.push(itemLine);
    });

    const embed = new EmbedBuilder()
        .setTitle('📈 سوق الاستثمار')
        .setColor("Random") 
        .setImage('https://i.postimg.cc/8cWwdnnG/mar.jpg') 
        .setDescription('\u200B') 
        .addFields(
            { name: '\u200B', value: col1.join('\n\n') || '\u200B', inline: true },
            { name: '\u200B', value: col2.join('\n\n') || '\u200B', inline: true },
            { name: '\u200B', value: col3.join('\n\n') || '\u200B', inline: true }
        )
        .setFooter({ text: `سيتم تحديث الأسعار بعد: ${timeRemaining}` });

    const selectOptions = itemsOnPage.map(item => ({
        label: `${cleanEmojiFromName(item.name)}`,
        description: `السعر الحالي: ${item.currentPrice.toLocaleString()} مورا`,
        value: item.id,
        emoji: EMOJI_ASSET_SMALL[item.id] || '📈'
    }));

    const selectMenuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('market_select_item')
            .setPlaceholder('اختر الأصل لعرض التفاصيل...')
            .addOptions(selectOptions)
    );

    return { embed, components: [selectMenuRow] };
}

function buildDetailView(item, userId, guildId, allItems, timeRemaining, sql) {
    const userPortfolio = sql.prepare("SELECT quantity FROM user_portfolio WHERE userID = ? AND guildID = ? AND itemID = ?").get(userId, guildId, item.id);
    const userQuantity = userPortfolio ? userPortfolio.quantity : 0;
    const changeEmoji = getItemChangeEmoji(item.lastChangePercent);
    const price = item.currentPrice.toLocaleString();
    const cleanName = cleanEmojiFromName(item.name);

    const detailEmbed = new EmbedBuilder()
        .setTitle(`📈 تفاصيل: ${cleanName} (${item.id})`)
        .setColor(item.lastChangePercent > 0.01 ? Colors.Green : (item.lastChangePercent < -0.01 ? Colors.Red : Colors.Grey))
        .setDescription(item.description || 'لا يوجد وصف')
        .addFields(
            { name: 'السعر الحالي', value: `${price} ${EMOJI_MORA}`, inline: true },
            { name: 'تغير الفترة الأخيرة', value: `${changeEmoji} ${(item.lastChangePercent * 100).toFixed(1)}%`, inline: true },
            { name: 'في محفظتك', value: `**${userQuantity.toLocaleString()}**`, inline: true }
        )
        .setTimestamp();

    const itemImage = EMOJI_ASSET_IMAGES[item.id];
    if (itemImage) {
        detailEmbed.setThumbnail(itemImage);
    }

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`market_prev_${item.id}`).setLabel('◀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`market_next_${item.id}`).setLabel('▶️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`buy_asset_${item.id}`).setLabel('شراء').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sell_asset_${item.id}`).setLabel(`بيع`).setStyle(ButtonStyle.Danger).setDisabled(userQuantity === 0),
        new ButtonBuilder().setCustomId('market_back_to_grid').setLabel('العودة').setStyle(ButtonStyle.Primary)
    );

    return { embed: detailEmbed, components: [actionRow] };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('سوق')
        .setDescription('يعرض أسعار الأسهم والعقارات الحالية في قائمة تفاعلية.'),

    name: 'market',
    aliases: ['سوق', 'استثمار', 'اسعار'],
    category: "Economy",
    description: 'يعرض أسعار الأسهم والعقارات الحالية في قائمة تفاعلية.',

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

        // 🔥 1. جلب العناصر من قاعدة البيانات
        const dbItems = sql.prepare("SELECT * FROM market_items").all();

        // 🔥 2. تصفية العناصر: نعرض فقط العناصر الموجودة في ملف JSON (الأسهم والعقارات)
        // هذا سيستبعد الطعوم وأي شيء آخر غير معرف في ملف market-items.json
        const validItemIds = new Set(marketConfig.map(i => i.id));
        const allItems = dbItems.filter(item => validItemIds.has(item.id));

        if (allItems.length === 0) {
            const embed = new EmbedBuilder().setTitle('📈 سوق الاستثمار').setDescription("السوق فارغ حالياً.").setColor(Colors.Red);
            return reply({ embeds: [embed] });
        }

        let currentPage = 0;
        let currentItemIndex = 0;
        let currentView = 'grid'; 
        let timeRemaining = getUpdateTimeRemaining();

        const { embed, components } = buildGridView(allItems, currentPage, timeRemaining);
        const msg = await reply({ embeds: [embed], components: components, fetchReply: true });

        const filter = i => i.user.id === user.id;
        const collector = msg.createMessageComponentCollector({
            time: 180000,
            filter,
        });

        collector.on('collect', async i => {
            try {

                if (i.isButton()) {
                    if (i.customId.startsWith('market_prev') || i.customId.startsWith('market_next')) {
                        await i.deferUpdate(); 

                        if (currentView === 'grid') {
                            if (i.customId === 'market_next') currentPage = Math.min(Math.ceil(allItems.length / ITEMS_PER_PAGE) - 1, currentPage + 1);
                            else if (i.customId === 'market_prev') currentPage = Math.max(0, currentPage - 1);

                            timeRemaining = getUpdateTimeRemaining();
                            const newPage = buildGridView(allItems, currentPage, timeRemaining);
                            await i.editReply({ embeds: [newPage.embed], components: newPage.components });

                        } else { 
                            const currentItemID = i.customId.split('_')[2];
                            currentItemIndex = allItems.findIndex(it => it.id === currentItemID);

                            if (i.customId.startsWith('market_next')) {
                                currentItemIndex = (currentItemIndex + 1) % allItems.length;
                            } else if (i.customId.startsWith('market_prev')) {
                                currentItemIndex = (currentItemIndex - 1 + allItems.length) % allItems.length;
                            }

                            const item = allItems[currentItemIndex];
                            const { embed: detailEmbed, components: detailComponents } = buildDetailView(item, i.user.id, i.guild.id, allItems, timeRemaining, sql); 
                            await i.editReply({ embeds: [detailEmbed], components: detailComponents });
                        }

                    } else if (i.customId === 'market_back_to_grid') {
                        await i.deferUpdate(); 
                        currentView = 'grid';
                        timeRemaining = getUpdateTimeRemaining();
                        const { embed: gridEmbed, components: gridComponents } = buildGridView(allItems, currentPage, timeRemaining);
                        await i.editReply({ embeds: [gridEmbed], components: gridComponents });

                    } else if (i.customId.startsWith('buy_asset_') || i.customId.startsWith('sell_asset_')) {
                        const isBuy = i.customId.startsWith('buy_asset_');
                        const assetId = i.customId.replace(isBuy ? 'buy_asset_' : 'sell_asset_', '');
                        const item = allItems.find(it => it.id === assetId);

                        if (!item) return;

                        const modal = new ModalBuilder()
                            .setCustomId(`${isBuy ? 'buy_modal_' : 'sell_modal_'}${assetId}`)
                            .setTitle("أدخل الكمية");

                        const quantityInput = new TextInputBuilder()
                            .setCustomId('quantity_input')
                            .setLabel(isBuy ? "الكمية التي تريد شراءها" : "الكمية التي تريد بيعها")
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(`السعر الحالي: ${item.currentPrice.toLocaleString()}`)
                            .setRequired(true);

                        modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
                        await i.showModal(modal);
                    }
                }

                else if (i.isStringSelectMenu() && i.customId === 'market_select_item') {
                    await i.deferUpdate(); 
                    currentView = 'detail';
                    const selectedID = i.values[0];
                    currentItemIndex = allItems.findIndex(it => it.id === selectedID);
                    const item = allItems[currentItemIndex];
                    const { embed: detailEmbed, components: detailComponents } = buildDetailView(item, i.user.id, i.guild.id, allItems, timeRemaining, sql); 
                    await i.editReply({ embeds: [detailEmbed], components: detailComponents });
                }
            } catch (error) {
                console.error("خطأ في جامع السوق:", error);
                try {
                    if (i.replied || i.deferred) { 
                        await i.followUp({ content: '❌ حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.', ephemeral: true });
                    } else {
                    }
                } catch (e) {
                    console.error("لا يمكن إرسال رسالة الخطأ:", e);
                }
            }
        });

        collector.on('end', () => {
            msg.edit({ components: [] }).catch(() => null);
        });
    }
};
