const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const marketConfig = require('../../json/market-items.json'); // 🔥 استيراد ملف عناصر السوق فقط

const EMOJI_MORA = '<:mora:1435647151349698621>'; 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ممتلكات')
        .setDescription('يعرض الأسهم والعقارات التي تملكها.')
        .addUserOption(option => 
            option.setName('المستخدم')
            .setDescription('المستخدم الذي تريد عرض محفظته')
            .setRequired(false)),

    name: 'portfolio',
    aliases: ['محفظتي', 'استثماراتي', 'ممتلكات'],
    category: "Economy",
    description: 'يعرض الأسهم والعقارات التي تملكها.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client;
        let user;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            user = interaction.options.getMember('المستخدم') || interaction.member;
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            user = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.channel.send(payload);
            }
        };

        const sql = client.sql;

        // جلب ممتلكات المستخدم من القاعدة
        const portfolio = sql.prepare("SELECT * FROM user_portfolio WHERE guildID = ? AND userID = ?").all(guild.id, user.id);
        
        // 🔥 التعديل هنا: استخدام ملف JSON لتحديد ما هي عناصر السوق المسموح عرضها فقط
        // هذا سيمنع ظهور الطعوم أو أي أغراض أخرى ليست في ملف market-items.json
        const market = new Map(marketConfig.map(item => [item.id, item]));

        const embed = new EmbedBuilder()
            .setTitle(`💼 اصـول الاستثمـارات لـ ${user.displayName}`)
            .setColor("Gold")
            .setThumbnail(user.displayAvatarURL())
            .setImage('https://media.discordapp.net/attachments/1394280285289320550/1432409477272965190/line.png?ex=690eca88&is=690d7908&hm=b21b91d8e7b66da4c28a29dd513bd1104c76ab6c875f23cd9405daf3ce48c050&=&format=webp&quality=lossless');

        // مصفوفة لتخزين العناصر الصالحة للعرض فقط
        let validItems = [];
        let totalValue = 0;

        for (const item of portfolio) {
            // التحقق مما إذا كان العنصر موجوداً في قائمة السوق (JSON)
            const marketItem = market.get(item.itemID);
            
            // إذا لم يكن موجوداً في ملف السوق (مثل الطعوم)، يتم تجاهله
            if (!marketItem) continue;

            const currentValue = marketItem.price * item.quantity; // ملاحظة: في ملف JSON السعر اسمه price وليس currentPrice
            // إذا كنت تستخدم نظام تغير الأسعار في الداتابيس، سنحاول جلب السعر المحدث أولاً
            
            // محاولة جلب السعر المحدث من الداتابيس إذا وجد، وإلا استخدام السعر الأساسي من الملف
            let currentPrice = marketItem.price;
            try {
                const dbItem = sql.prepare("SELECT currentPrice FROM market_items WHERE id = ?").get(item.itemID);
                if (dbItem && dbItem.currentPrice) currentPrice = dbItem.currentPrice;
            } catch (e) {}

            const itemTotalValue = currentPrice * item.quantity;
            totalValue += itemTotalValue;

            validItems.push({
                name: marketItem.name,
                quantity: item.quantity,
                value: itemTotalValue,
                price: currentPrice
            });
        }

        if (validItems.length === 0) {
            embed.setDescription("✥ محفظتك الاستثمارية فارغة حالياً. استخدم `/market` لشراء الأصول.");
        } else {
            let descriptionLines = []; 
            
            for (const vItem of validItems) {
                descriptionLines.push(`**✶ ${vItem.name} العدد: ${vItem.quantity.toLocaleString()}**`);
                descriptionLines.push(`✬ قيمـة الاصـل: ${vItem.value.toLocaleString()} ${EMOJI_MORA}`);
                descriptionLines.push(`✦ سعـر الاصـل: ${vItem.price.toLocaleString()} ${EMOJI_MORA}`);
                descriptionLines.push(`\u200B`); // سطر فاصل
            }

            embed.setDescription(
                `✥ قيمة الاصول الكلية: **${totalValue.toLocaleString()}** ${EMOJI_MORA}\n\n` + 
                descriptionLines.join('\n')
            );
        }

        await reply({ embeds: [embed] });
    }
};
