const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Colors, SlashCommandBuilder, Collection } = require("discord.js");
const EMOJI_MORA = '<:mora:1435647151349698621>';

const MIN_BET = 25;
const MAX_BET_SOLO = 100; // 🔒 الحد الأقصى للعب الفردي
const SOLO_ATTEMPTS = 7;
const COOLDOWN_MS = 1 * 60 * 60 * 1000;

const activeGames = new Set();

function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('تخمين')
        .setDescription('لعبة تخمين الرقم (فردي أو جماعي).')
        .addIntegerOption(option =>
            option.setName('الرهان')
                .setDescription(`المبلغ الذي تريد المراهنة به`)
                .setRequired(true)
                .setMinValue(MIN_BET)
        )
        .addUserOption(option => option.setName('الخصم1').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم2').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم3').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم4').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم5').setDescription('تحدي لاعب آخر').setRequired(false)),

    name: 'guess',
    aliases: ['خمن', 'g', 'تخمين'],
    category: "Economy",
    description: `لعبة تخمين الرقم (فردي أو جماعي).`,

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, author, client, guild, sql, channel, channelId;
        let bet, opponents = new Collection();

        try {
            if (isSlash) {
                interaction = interactionOrMessage;
                author = interaction.member;
                client = interaction.client;
                guild = interaction.guild;
                sql = client.sql;
                channel = interaction.channel;
                channelId = interaction.channel.id;

                bet = interaction.options.getInteger('الرهان');

                for (let i = 1; i <= 5; i++) {
                    const user = interaction.options.getUser(`الخصم${i}`);
                    if (user) {
                        const member = await guild.members.fetch(user.id).catch(() => null);
                        if (member && !member.user.bot && member.id !== author.id) {
                            opponents.set(member.id, member);
                        }
                    }
                }
                await interaction.deferReply();
            } else {
                message = interactionOrMessage;
                author = message.member;
                client = message.client;
                guild = message.guild;
                sql = client.sql;
                channel = message.channel;
                channelId = message.channel.id;

                if (!args[0] || isNaN(parseInt(args[0]))) {
                    return message.reply(`الاستخدام: \`-تخمين <المبلغ> [@لاعبين...]\``);
                }
                bet = parseInt(args[0]);
                opponents = message.mentions.members.filter(m => !m.user.bot && m.id !== author.id);
            }

            const reply = async (payload) => {
                if (isSlash) return interaction.editReply(payload);
                return message.channel.send(payload);
            };

            const replyError = async (content) => {
                const payload = { content, ephemeral: true };
                if (isSlash) return interaction.editReply(payload);
                return message.reply(payload);
            };

            if (activeGames.has(channelId)) {
                return replyError("🚫 هناك لعبة نشطة بالفعل في هذه القناة!");
            }

            // 1. التحقق من الحد الأدنى
            if (bet < MIN_BET) {
                return replyError(`❌ الحد الأدنى للرهان هو **${MIN_BET}** ${EMOJI_MORA}.`);
            }

            // 2. التحقق من الحد الأقصى (للفردي فقط)
            if (opponents.size === 0 && bet > MAX_BET_SOLO) {
                return replyError(`🚫 الحد الأقصى للرهان الفردي (ضد البوت) هو **${MAX_BET_SOLO}** ${EMOJI_MORA}.\n(لتراهن بأكثر، تحدى لاعباً آخر).`);
            }

            const getScore = client.getLevel;
            const setScore = client.setLevel;
            let authorData = getScore.get(author.id, guild.id);

            if (!authorData) authorData = { ...client.defaultData, user: author.id, guild: guild.id };

            // الكولداون
            const now = Date.now();
            const timeLeft = (authorData.lastGuess || 0) + COOLDOWN_MS - now;
            if (timeLeft > 0) {
                return replyError(`🕐 انتظر **\`${formatTime(timeLeft)}\`** قبل اللعب مرة أخرى.`);
            }

            // التحقق من رصيد صاحب اللعبة
            if (authorData.mora < bet) {
                return replyError(`❌ ليس لديك رصيد كافٍ! (رصيدك: ${authorData.mora} ${EMOJI_MORA})`);
            }

            activeGames.add(channelId);
            authorData.lastGuess = now;

            if (opponents.size === 0) {
                await playSolo(channel, author, bet, authorData, getScore, setScore, sql, reply);
            } else {
                await playChallenge(channel, author, opponents, bet, authorData, getScore, setScore, sql, reply);
            }

        } catch (error) {
            console.error("Guess Error:", error);
            activeGames.delete(channelId);
        }
    }
};

async function playSolo(channel, author, bet, authorData, getScore, setScore, sql, replyFunction) {
    const targetNumber = Math.floor(Math.random() * 100) + 1;
    let attempts = 0;
    
    // الجائزة: الرهان * 7
    const maxWin = bet * 7;
    let currentPrize = maxWin;
    const penalty = Math.floor(maxWin / SOLO_ATTEMPTS);

    const embed = new EmbedBuilder()
        .setTitle('🎲 لعبة التخـمـين')
        .setDescription(`**الرهان:** ${bet} ${EMOJI_MORA}\n**الجائزة:** تصل إلى ${maxWin} ${EMOJI_MORA}\n\nخمن رقماً بين **1 و 100**.\nلديك **${SOLO_ATTEMPTS}** محاولات.`)
        .setColor(Colors.Blue)
        .setFooter({ text: 'اكتب تخمينك في الشات...' });

    await replyFunction({ embeds: [embed] });

    const collector = channel.createMessageCollector({ 
        filter: m => m.author.id === author.id && !isNaN(parseInt(m.content)), 
        time: 60000, 
        max: SOLO_ATTEMPTS 
    });

    collector.on('collect', (msg) => {
        const guess = parseInt(msg.content);
        attempts++;
        const left = SOLO_ATTEMPTS - attempts;

        if (guess === targetNumber) {
            
            authorData.mora += currentPrize;
            setScore.run(authorData);

            const winEmbed = new EmbedBuilder()
                .setTitle('🎉 مبروك!')
                .setDescription(`الرقم الصحيح هو **${targetNumber}**!\nربحت **${currentPrize}** ${EMOJI_MORA}!`)
                .setColor(Colors.Green);
            
            msg.reply({ embeds: [winEmbed] });
            collector.stop('win');

        } else {
            if (left === 0) {
                collector.stop('lose');
            } else {
                currentPrize -= penalty;
                const hint = guess < targetNumber ? "أكبر 🔼" : "أصغر 🔽";
                msg.reply(`الرقم **${hint}**! (باقي ${left} محاولات)`);
            }
        }
    });

    collector.on('end', (collected, reason) => {
        activeGames.delete(channel.id);
        if (reason === 'lose' || reason === 'time') {
            // الخسارة: خصم الرهان
            authorData.mora -= bet;
            setScore.run(authorData);

            const loseEmbed = new EmbedBuilder()
                .setTitle('❌ حظ أوفر!')
                .setDescription(`انتهت المحاولات.\nالرقم كان: **${targetNumber}**\nخسرت **${bet}** ${EMOJI_MORA}.`)
                .setColor(Colors.Red);
            channel.send({ embeds: [loseEmbed] });
        }
    });
}

async function playChallenge(channel, author, opponents, bet, authorData, getScore, setScore, sql, replyFunction) {
    // التحقق من أرصدة الخصوم
    for (const opp of opponents.values()) {
        const oppData = getScore.get(opp.id, channel.guild.id);
        if (!oppData || oppData.mora < bet) {
            activeGames.delete(channel.id);
            return replyFunction({ content: `🚫 اللاعب ${opp} لا يملك مبلغ الرهان!`, ephemeral: true });
        }
    }

    const totalPot = bet * (opponents.size + 1);
    const players = [author, ...opponents.values()];
    const playerIds = players.map(p => p.id);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('guess_accept').setLabel('قبول التحدي').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('guess_decline').setLabel('رفض').setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
        .setTitle('⚔️ تحدي تخمين جماعي!')
        .setDescription(`**${author}** يتحدى **${opponents.map(o => o.displayName).join(', ')}**!\n\n💰 الرهان: **${bet}** ${EMOJI_MORA} (لكل لاعب)\n🏆 الجائزة: **${totalPot}** ${EMOJI_MORA}\n\nلديك 60 ثانية للقبول.`)
        .setColor(Colors.Gold);

    const msg = await replyFunction({ content: opponents.map(o => o.toString()).join(' '), embeds: [embed], components: [row], fetchReply: true });

    const accepted = new Set([author.id]);
    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
        if (!playerIds.includes(i.user.id)) return i.reply({ content: "هذا التحدي ليس لك.", ephemeral: true });

        if (i.customId === 'guess_decline') {
            collector.stop('declined');
            return i.update({ content: `❌ رفض ${i.user} التحدي.`, embeds: [], components: [] });
        }

        if (i.customId === 'guess_accept') {
            if (accepted.has(i.user.id)) return i.reply({ content: "لقد قبلت بالفعل.", ephemeral: true });
            accepted.add(i.user.id);
            await i.reply({ content: `✅ قبل ${i.user} التحدي!`, ephemeral: true });

            if (accepted.size === players.length) {
                collector.stop('start');
            }
        }
    });

    collector.on('end', async (c, reason) => {
        if (reason !== 'start') {
            activeGames.delete(channel.id);
            if (reason !== 'declined') msg.edit({ content: "⏰ انتهى الوقت ولم يقبل الجميع.", embeds: [], components: [] });
            return;
        }

        // بدء اللعبة - خصم الرهان من الجميع
        for (const p of players) {
            let d = getScore.get(p.id, channel.guild.id);
            if (!d) d = { ...channel.client.defaultData, user: p.id, guild: channel.guild.id };
            d.mora -= bet;
            if (p.id !== author.id) d.lastGuess = Date.now(); // تفعيل الكولداون للخصوم أيضاً
            setScore.run(d);
        }

        const targetNumber = Math.floor(Math.random() * 100) + 1;
        const gameEmbed = new EmbedBuilder()
            .setTitle('🚀 بدأ السباق!')
            .setDescription(`الرقم بين **1 و 100**.\nأول شخص يخمن الرقم يفوز بـ **${totalPot}** ${EMOJI_MORA}!\n\nاكتب تخمينك الآن!`)
            .setColor(Colors.Orange);

        await msg.edit({ content: players.map(p => p.toString()).join(' '), embeds: [gameEmbed], components: [] });

        const gameCollector = channel.createMessageCollector({ 
            filter: m => playerIds.includes(m.author.id) && !isNaN(parseInt(m.content)), 
            time: 60000 
        });

        gameCollector.on('collect', (m) => {
            const guess = parseInt(m.content);
            if (guess === targetNumber) {
                // الفائز يأخذ الكل
                let wData = getScore.get(m.author.id, channel.guild.id);
                wData.mora += totalPot;
                setScore.run(wData);

                const winEmbed = new EmbedBuilder()
                    .setTitle(`👑 الفائز: ${m.author.displayName}`)
                    .setDescription(`الرقم كان **${targetNumber}**.\nمبروك الفوز بـ **${totalPot}** ${EMOJI_MORA}!`)
                    .setColor(Colors.Gold);
                
                channel.send({ embeds: [winEmbed] });
                gameCollector.stop('win');
            } else {
                const hint = guess < targetNumber ? "أكبر 🔼" : "أصغر 🔽";
                // رد بسيط عشان ما يزعج الشات
                // m.react(guess < targetNumber ? '⬆️' : '⬇️'); 
                // أو رسالة:
                channel.send(`**${m.author.displayName}**: ${hint}`);
            }
        });

        gameCollector.on('end', (col, reason) => {
            activeGames.delete(channel.id);
            if (reason !== 'win') {
                // انتهى الوقت، إرجاع الأموال
                for (const p of players) {
                    let d = getScore.get(p.id, channel.guild.id);
                    d.mora += bet;
                    setScore.run(d);
                }
                channel.send(`⏰ انتهى الوقت! الرقم كان **${targetNumber}**. تم استرجاع المورا للجميع.`);
            }
        });
    });
}
