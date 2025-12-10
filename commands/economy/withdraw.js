const { EmbedBuilder, Colors, SlashCommandBuilder } = require("discord.js");

const EMOJI_MORA = '<:mora:1435647151349698621>';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('سحب')
        .setDescription('سحب المورا من البنك إلى رصيدك (الكاش).')
        .addStringOption(option =>
            option.setName('المبلغ')
            .setDescription('المبلغ الذي تريد سحبه أو "all" / "الكل"')
            .setRequired(true)), // جعلناه إجبارياً لتوحيد النسق

    name: 'withdraw',
    aliases: ['سحب', 'with'],
    category: "Economy",
    cooldown: 0, 
    description: 'سحب المورا من البنك إلى رصيدك الكاش',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, user;
        let amountArg;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            user = interaction.user;
            amountArg = interaction.options.getString('المبلغ');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            user = message.author;
            amountArg = args[0];
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.channel.send(payload);
            }
        };

        const replyError = async (content) => {
            const payload = { content, ephemeral: true };
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.reply(payload);
            }
        };

        const guildId = guild.id;
        const getScore = client.getLevel;
        const setScore = client.setLevel;

        let data = getScore.get(user.id, guildId);
        if (!data) {
             data = { ...client.defaultData, user: user.id, guild: guildId };
        }

        // التأكد من وجود القيم لتجنب الأخطاء
        if (typeof data.mora === 'undefined') data.mora = 0;
        if (typeof data.bank === 'undefined') data.bank = 0;

        let amountToWithdraw;
        const userBank = data.bank || 0;

        if (!amountArg || amountArg.toLowerCase() === 'all' || amountArg.toLowerCase() === 'الكل') {
            amountToWithdraw = userBank;
        } else {
            amountToWithdraw = parseInt(amountArg.replace(/,/g, ''));
            if (isNaN(amountToWithdraw)) {
                 return replyError(`الاستخدام: \`/سحب <المبلغ | الكل>\` (المبلغ الذي أدخلته ليس رقماً).`);
            }
        }

        if (amountToWithdraw <= 0) {
            return replyError(`ليس لديك أي مورا في البنك لسحبها!`);
        }

        if (userBank < amountToWithdraw) {
            return replyError(`ليس لديك هذا المبلغ في البنك لسحبه! (رصيدك البنكي: ${userBank.toLocaleString()} ${EMOJI_MORA})`);
        }

        // تنفيذ عملية السحب
        data.bank -= amountToWithdraw;
        data.mora += amountToWithdraw;

        setScore.run(data);

        const embed = new EmbedBuilder()
            .setColor("Random") // لون عشوائي
            .setTitle('✶ تـمت عمليـة السحـب !')
            .setThumbnail(user.displayAvatarURL()) // صورة البروفايل
            .setDescription(
                `❖ تـم السحب: **${amountToWithdraw.toLocaleString()}** ${EMOJI_MORA}\n` +
                `❖ رصـيد البـنك: **${data.bank.toLocaleString()}** ${EMOJI_MORA}\n` +
                `❖ رصـيـدك الكـاش: **${data.mora.toLocaleString()}** ${EMOJI_MORA}`
            );

        await reply({ embeds: [embed] });
    }
};
