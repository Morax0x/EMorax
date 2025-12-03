const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Colors, SlashCommandBuilder } = require("discord.js");
const { calculateMoraBuff } = require('../../streak-handler.js');
const EMOJI_MORA = '<:mora:1435647151349698621>';

const MIN_CASH_PERCENT = 0.05;
const MAX_CASH_PERCENT = 0.10;
const MIN_BANK_PERCENT = 0.01;
const MAX_BANK_PERCENT = 0.05;
const ROBBER_FINE_PERCENT = 0.10;

const MIN_ROB_AMOUNT = 100;
const MIN_REQUIRED_CASH = 500;
const COOLDOWN_MS = 1 * 60 * 60 * 1000;

const activeGames = new Set();

function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');

    if (hours > 0) {
        return `${hh}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
}

// دالة مساعدة لخصم المبلغ من السارق (كاش أولاً ثم بنك)
function deductFromRobber(data, amount) {
    if (data.mora >= amount) {
        data.mora -= amount;
    } else {
        const remaining = amount - data.mora;
        data.mora = 0; // تصفير الكاش
        data.bank -= remaining; // خصم الباقي من البنك
    }
    return data;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('سرقة')
        .setDescription('محاولة سرقة المورا (الكاش أو البنك) من عضو آخر.')
        .addUserOption(option => 
            option.setName('الضحية')
            .setDescription('العضو الذي تريد سرقته')
            .setRequired(true)),

    name: 'rob',
    aliases: ['سرقة', 'نهب',],
    category: "Economy",
    description: 'محاولة سرقة المورا (الكاش أو البنك) من عضو آخر.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, robber;
        let victim;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            robber = interaction.member;
            victim = interaction.options.getMember('الضحية');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            robber = message.member;
            victim = message.mentions.members.first();
        }

        const channel = interactionOrMessage.channel;

        const reply = async (payload) => {
            if (typeof payload === 'string') payload = { content: payload };

            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.reply(payload);
            }
        };

        const sql = client.sql;

        if (activeGames.has(channel.id)) {
            return reply("هناك عملية سرقة نشطة بالفعل في هذه القناة!");
        }

        if (!victim) {
            return reply("الاستخدام: /سرقة <@user> أو -rob <@user>");
        }

        if (victim.id === robber.id) {
            return reply("تـسـرق نـفـسـك؟ غـبـي انـت؟؟ <:mirkk:1435648219488190525>");
        }

        const getScore = client.getLevel;
        const setScore = client.setLevel;

        let robberData = getScore.get(robber.id, guild.id);
        if (!robberData) {
            robberData = { ...client.defaultData, user: robber.id, guild: guild.id };
        }

        let victimData = getScore.get(victim.id, guild.id);
        if (!victimData) {
            victimData = { ...client.defaultData, user: victim.id, guild: guild.id };
        }

        const now = Date.now();
        const timeLeft = (robberData.lastRob || 0) + COOLDOWN_MS - now;

        if (timeLeft > 0) {
            const timeString = formatTime(timeLeft);
            return reply(`🕐حـرامـي مـجتـهد انـت <:stop:1436337453098340442> انتـظـر **\`${timeString}\`** عشان تسـوي عمـليـة سـطو ثـانيـة.`);
        }

        const victimMora = victimData.mora || 0;
        const victimBank = victimData.bank || 0;
        const robberMora = robberData.mora || 0;
        const robberBank = robberData.bank || 0;
        const robberTotal = robberMora + robberBank; // مجموع ثروة السارق

        // تعديل الشرط: التحقق من المجموع (كاش + بنك)
        if (robberTotal < MIN_REQUIRED_CASH) {
             return reply(`يجب أن تمتلك مجموع **${MIN_REQUIRED_CASH.toLocaleString()}** ${EMOJI_MORA} (كاش أو بنك) لتغطية الغرامة إذا فشلت.`);
        }

        if (victimMora < MIN_REQUIRED_CASH && victimBank < MIN_REQUIRED_CASH) {
            return reply(`هذا العضو فقير جداً ولا يملك الحد الأدنى للسرقة (${MIN_REQUIRED_CASH.toLocaleString()} ${EMOJI_MORA}) في الكاش أو البنك.`);
        }

        let targetPool;
        let poolName;
        let victimPoolAmount;

        const canStealBank = victimBank >= MIN_REQUIRED_CASH;
        const canStealMora = victimMora >= MIN_REQUIRED_CASH;

        if (canStealBank && canStealMora) {
            targetPool = Math.random() < 0.5 ? 'mora' : 'bank';
        } else if (canStealBank) {
            targetPool = 'bank';
        } else {
            targetPool = 'mora';
        }

        if (targetPool === 'bank') {
            poolName = "البنك";
            victimPoolAmount = victimBank;
        } else {
            poolName = "الكاش";
            victimPoolAmount = victimMora;
        }

        // حساب الحد الأقصى بناءً على إجمالي ثروة السارق
        const robberCap = Math.floor(robberTotal * ROBBER_FINE_PERCENT);

        let victimCap;
        if (targetPool === 'bank') {
            const randomPercent = Math.random() * (MAX_BANK_PERCENT - MIN_BANK_PERCENT) + MIN_BANK_PERCENT;
            victimCap = Math.floor(victimPoolAmount * randomPercent);
        } else {
            const randomPercent = Math.random() * (MAX_CASH_PERCENT - MIN_CASH_PERCENT) + MIN_CASH_PERCENT;
            victimCap = Math.floor(victimPoolAmount * randomPercent);
        }

        let amountToSteal = Math.min(robberCap, victimCap);
        amountToSteal = Math.max(amountToSteal, MIN_ROB_AMOUNT);

        robberData.lastRob = now;

        // --- التحقق من الحارس (Guard) ---
        if (victimData.hasGuard > 0) {
            // استخدام دالة الخصم الذكي
            deductFromRobber(robberData, amountToSteal);
            
            victimData.mora += amountToSteal;
            victimData.hasGuard -= 1;
            victimData.guardExpires = 0;

            setScore.run(robberData);
            setScore.run(victimData);

            const embed = new EmbedBuilder()
                .setTitle('✶ تــم الـقـبـض :shield: !')
                .setColor('#46455f')
                .setImage('https://i.postimg.cc/Hx6tZnJv/nskht-mn-ambratwryt-alanmy.jpg')
                .setDescription(
                    `✬ حـاولـت الـسطـو عـلى ممتـلكـات ${victim}\n <:thief:1436331309961187488>` +
                    `✬ ولـكـن الحـارس الـشخـصـي قبـض عليك وجـلدك <:catla:1437335118153781360>\n\n` +
                    `✬ تـم تغريـمك **${amountToSteal.toLocaleString()}** ${EMOJI_MORA} (من رصيدك) واعطـائـها للضحـية <:mirkk:1435648219488190525>`
                );

            return reply({ embeds: [embed] });
        }

        activeGames.add(channel.id);

        const description = [
            `✦ انـت تسـطو علـى ممتـلكـات: ${victim} <:thief:1436331309961187488>`,
            `⌕ اخـتـر البـاب الصحـيـح الـذي يحـوي عـلـى ${amountToSteal.toLocaleString()} ${EMOJI_MORA} (من ${poolName})!`,
            `لديـك 15 ثانيـة لاختيـار البـاب الصحيـح :bomb:`
        ].join('\n');

        const embed = new EmbedBuilder()
            .setTitle('✥ عملـيـة سـطـو ...')
            .setDescription(description)
            .setColor('#8B4513')
            .setImage('https://i.postimg.cc/mkRP0fq6/door.gif');

        const buttons = [
            new ButtonBuilder().setCustomId('rob_1').setLabel('🚪').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rob_2').setLabel('🚪').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rob_3').setLabel('🚪').setStyle(ButtonStyle.Secondary)
        ];

        const correctButton = Math.floor(Math.random() * 3);
        buttons[correctButton].setCustomId('rob_correct');

        const row = new ActionRowBuilder().addComponents(buttons);
        const msg = await reply({ embeds: [embed], components: [row] });

        const filter = i => i.user.id === robber.id;
        const collector = msg.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 15000, max: 1 });

        collector.on('collect', async i => {
            if (i.customId === 'rob_correct') {

                const moraMultiplier = calculateMoraBuff(robber, sql);
                const finalAmount = Math.floor(amountToSteal * moraMultiplier);
                const buffPercent = (moraMultiplier - 1) * 100;

                robberData.mora += finalAmount;
                victimData[targetPool] -= finalAmount;

                let buffString = "";
                if (buffPercent > 0) {
                    buffString = ` (+${buffPercent.toFixed(0)}%)`;
                } else if (buffPercent < 0) {
                    buffString = ` (-${buffPercent.toFixed(0)}%)`;
                }

                const winEmbed = new EmbedBuilder()
                    .setTitle('✅ حـرامـي مـحـتـرف <:thief:1436331309961187488>')
                    .setColor(Colors.Orange)
                    .setImage('https://i.postimg.cc/QVLQyyDK/rob.gif')
                    .setDescription(`لقد اخترت الباب الصحيح وسرقت **${finalAmount.toLocaleString()}** ${EMOJI_MORA}${buffString} من (${poolName}) الخاص بـ ${victim.displayName}!`);
                await i.update({ embeds: [winEmbed], components: [] });

            } else {
                // استخدام دالة الخصم الذكي عند الخسارة
                deductFromRobber(robberData, amountToSteal);
                victimData.mora += amountToSteal;

                const loseEmbed = new EmbedBuilder()
                    .setTitle('💥 بــــووم !')
                    .setColor(Colors.Red)
                    .setImage('https://i.postimg.cc/HkdZWrG5/boom.gif')
                    .setDescription(`لقد اخترت الباب الخطأ وانفجرت القنبلة!\n\nفشلت السرقة، وتم تغريمك **${amountToSteal.toLocaleString()}** ${EMOJI_MORA} (من رصيدك) وإعطاؤها للضحية.`);
                await i.update({ embeds: [loseEmbed], components: [] });
            }
            setScore.run(robberData);
            setScore.run(victimData);
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                // استخدام دالة الخصم الذكي عند انتهاء الوقت
                deductFromRobber(robberData, amountToSteal);
                victimData.mora += amountToSteal;
                
                setScore.run(robberData);
                setScore.run(victimData);

                const timeEmbed = new EmbedBuilder()
                    .setTitle('⏰ انتهى الوقت!')
                    .setColor(Colors.Red)
                    .setImage('https://i.postimg.cc/Hx6tZnJv/nskht-mn-ambratwryt-alanmy.jpg')
                    .setDescription(`لقد ترددت طويلاً وتم القبض عليك!\n\nفشلت السرقة، وتم تغريمك **${amountToSteal.toLocaleString()}** ${EMOJI_MORA} (من رصيدك) وإعطاؤها للضحية.`);

                msg.edit({ embeds: [timeEmbed], components: [] });
            }
            activeGames.delete(channel.id);
        });
    }
};
