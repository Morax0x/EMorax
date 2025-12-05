const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Colors, SlashCommandBuilder, Collection } = require("discord.js");
const { calculateMoraBuff } = require('../../streak-handler.js');
const EMOJI_MORA = '<:mora:1435647151349698621>';
const MAX_BET = 100;
const MAX_PLAYERS = 5;
const activeGames = new Set();
const CHAMBER_COUNT = 6;
const COOLDOWN_MS = 1 * 60 * 60 * 1000;

const PULL_EMOJIS = ['🎯', '😮‍💨', '🥶', '🤯', '👑'];

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

function getMultipliers(playerCount) {
    if (playerCount === 1) {
        return [1.2, 1.5, 2.0, 3.0, 4.0];
    } else if (playerCount === 2) {
        return [1.1, 1.3, 1.6, 2.0, 2.5];
    } else if (playerCount === 3) {
        return [1.1, 1.2, 1.4, 1.7, 2.0];
    } else {
        return [1.1, 1.2, 1.3, 1.5, 1.8];
    }
}

function setupChambers() {
    const chambers = Array(CHAMBER_COUNT).fill(0);
    const bulletPosition = Math.floor(Math.random() * CHAMBER_COUNT);
    chambers[bulletPosition] = 1;
    return chambers;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('روليت')
        .setDescription('لعبة الروليت الروسية. العبها وحدك (لمضاعفة الربح) أو تحدي أصدقائك!')
        .addIntegerOption(option =>
            option.setName('المبلغ')
            .setDescription('مبلغ الرهان')
            .setRequired(true)
            .setMinValue(1))
        .addUserOption(option => option.setName('خصم1').setDescription('الخصم الأول').setRequired(false))
        .addUserOption(option => option.setName('خصم2').setDescription('الخصم الثاني').setRequired(false))
        .addUserOption(option => option.setName('خصم3').setDescription('الخصم الثالث').setRequired(false))
        .addUserOption(option => option.setName('خصم4').setDescription('الخصم الرابع').setRequired(false))
        .addUserOption(option => option.setName('خصم5').setDescription('الخصم الخامس').setRequired(false)),

    name: 'roulette',
    aliases: ['روليت', 'rl'],
    category: "Economy",
    description: `لعبة الروليت الروسية. العبها وحدك (لمضاعفة الربح) أو تحدي أصدقائك!`,

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, author;
        let bet;
        let opponents;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            author = interaction.member;
            bet = interaction.options.getInteger('المبلغ');
            const slashOpponents = [
                interaction.options.getMember('خصم1'),
                interaction.options.getMember('خصم2'),
                interaction.options.getMember('خصم3'),
                interaction.options.getMember('خصم4'),
                interaction.options.getMember('خصم5')
            ].filter(p => p && p.id !== author.id);
            opponents = new Collection(slashOpponents.map(m => [m.id, m]));
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            author = message.member;
            bet = parseInt(args[0]);
            opponents = message.mentions.members.filter(m => m.id !== author.id);
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.reply(payload);
            }
        };

        const channel = interactionOrMessage.channel;
        const sql = client.sql;

        if (activeGames.has(channel.id)) {
            return reply("هناك لعبة روليت نشطة بالفعل في هذه القناة!");
        }
        if (isNaN(bet) || bet <= 0) {
            return reply(`الاستخدام: \`/روليت <مبلغ الرهان> [@لاعبين...]\``);
        }

        if (opponents.size === 0) {
            if (bet > MAX_BET) {
                return reply(`لا يمكنك المراهنة بأكثر من **${MAX_BET}** ${EMOJI_MORA} في اللعب الفردي!`);
            }
        }

        const getScore = client.getLevel;
        const setScore = client.setLevel;
        let authorData = getScore.get(author.id, guild.id);

        if (!authorData) {
            authorData = { ...client.defaultData, user: author.id, guild: guild.id };
        }

        const now = Date.now();
        const timeLeft = (authorData.lastRoulette || 0) + COOLDOWN_MS - now;

        if (timeLeft > 0) {
            const timeString = formatTime(timeLeft);
            return reply(`🕐 يمكنك لعب الروليت مرة واحدة كل ساعة. يرجى الانتظار **\`${timeString}\`**.`);
        }

        if (!authorData || authorData.mora < bet) {
            return reply(`ليس لديك مورا كافية لهذا الرهان! (رصيدك: ${authorData.mora})`);
        }

        activeGames.add(channel.id);
        authorData.lastRoulette = now;
        setScore.run(authorData);

        if (opponents.size === 0) {
            await playSolo(interactionOrMessage, reply, author, bet, authorData, getScore, setScore, sql);
        } else {
            await playChallenge(interactionOrMessage, reply, author, opponents, bet, authorData, getScore, setScore, sql);
        }
    }
};

async function playSolo(interactionOrMessage, reply, author, bet, authorData, getScore, setScore, sql) {
    const channel = interactionOrMessage.channel;
    let chambers = setupChambers();
    let currentTurn = 0;
    let currentMultiplier = 1.0;
    const MULTIPLIERS = getMultipliers(1);

    const embed = new EmbedBuilder()
        .setTitle('❖ رولــيـت')
        .setDescription(`رصـاصـة واحـدة بالمسدس راهـن وحاول النجـاة !`)
        .setColor("Random")
        .setImage('https://i.postimg.cc/J44F9YWS/gun.gif')
        .addFields({ name: 'الطلقة الحالية', value: `1 / ${CHAMBER_COUNT}`, inline: true }, { name: 'المضاعف الحالي', value: 'x1.0', inline: true });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roulette_pull').setLabel('سحب الزناد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('roulette_cashout').setLabel('انسحاب (Cash Out)').setStyle(ButtonStyle.Success).setDisabled(true)
    );

    const msg = await reply({ embeds: [embed], components: [row] });
    const filter = i => i.user.id === author.id;
    const collector = msg.createMessageComponentCollector({ filter, time: 120000 });

    collector.on('collect', async i => {
        if (i.customId === 'roulette_cashout') {
            const baseWinnings = Math.floor(bet * currentMultiplier);
            const moraMultiplier = calculateMoraBuff(author, sql);
            const finalWinnings = Math.floor(baseWinnings * moraMultiplier);

            authorData.mora += finalWinnings;
            setScore.run(authorData);
            const winEmbed = new EmbedBuilder()
                .setTitle('✅ لقد انسحبت! ونجوت')
                .setDescription(`لقد نجوت وانسحبت بربح مضاعف **x${currentMultiplier}**!\n\nربحت **${finalWinnings}** ${EMOJI_MORA}!`)
                .setColor(Colors.Green)
                .setImage('https://i.postimg.cc/K8QBCQmS/download-1.gif');
            await i.update({ embeds: [winEmbed], components: [] });
            return collector.stop();
        }

        if (i.customId === 'roulette_pull') {
            const shot = chambers[currentTurn];
            if (shot === 1) {
                authorData.mora -= bet;
                setScore.run(authorData);
                const loseEmbed = new EmbedBuilder()
                    .setTitle('💥 اطلـقت رصاصـة وخـسـرت')
                    .setDescription(`لقد سحبت الزناد في الغرفة الخطأ.\n\nخسرت رهانك: **${bet}** ${EMOJI_MORA}.`)
                    .setColor(Colors.Red)
                    .setImage('https://i.postimg.cc/3Np26Tx9/download.gif');
                await i.update({ embeds: [loseEmbed], components: [] });
                return collector.stop();
            } else {
                currentMultiplier = MULTIPLIERS[currentTurn];
                currentTurn++;

                if (currentTurn === 5) {
                    const baseMaxWinnings = Math.floor(bet * MULTIPLIERS[4]);
                    const moraMultiplier = calculateMoraBuff(author, sql);
                    const finalMaxWinnings = Math.floor(baseMaxWinnings * moraMultiplier);

                    authorData.mora += finalMaxWinnings;
                    setScore.run(authorData);
                    const maxWinEmbed = new EmbedBuilder()
                        .setTitle('🏆 نجاة أسطورية! فزت بكل شيء')
                        .setDescription(`لقد نجوت من 5 طلقات ووصلت الحد الأقصى للمضاعف **x${MULTIPLIERS[4]}**!\n\nربحت **${finalMaxWinnings}** ${EMOJI_MORA}!`)
                        .setColor(Colors.Gold)
                        .setImage('https://i.postimg.cc/K8QBCQmS/download-1.gif');
                    await i.update({ embeds: [maxWinEmbed], components: [] });
                    return collector.stop();
                }

                const currentProfit = Math.floor(bet * currentMultiplier);
                const moraMultiplier = calculateMoraBuff(author, sql);
                const finalProfit = Math.floor(currentProfit * moraMultiplier);

                const newEmbed = new EmbedBuilder()
                    .setTitle(`${PULL_EMOJIS[currentTurn - 1]} نجاة!`)
                    .setDescription(`*كليك*... الغرفة كانت فارغة.\nالرهان: **${bet}** ${EMOJI_MORA}\n\nاسحب الزناد مجدداً لزيادة المضاعف، أو انسحب الآن.`)
                    .setColor("Random")
                    .setImage('https://i.postimg.cc/J44F9YWS/gun.gif')
                    .addFields(
                        { name: 'الطلقة التالية', value: `${currentTurn + 1} / ${CHAMBER_COUNT}`, inline: true },
                        { name: 'المضاعف القادم', value: `x${MULTIPLIERS[currentTurn]}`, inline: true },
                        { name: 'الربح الحالي', value: `(x${currentMultiplier} = ${finalProfit})`, inline: false }
                    );

                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('roulette_pull').setLabel('سحب الزناد مجدداً').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('roulette_cashout').setLabel(`انسحاب (${finalProfit})`).setStyle(ButtonStyle.Success).setDisabled(false)
                );

                await i.update({ embeds: [newEmbed], components: [newRow] });
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        activeGames.delete(channel.id);

        if (reason === 'time') {
            if (currentMultiplier > 1.0) {
                const baseWinnings = Math.floor(bet * currentMultiplier);
                const moraMultiplier = calculateMoraBuff(author, sql);
                const finalWinnings = Math.floor(baseWinnings * moraMultiplier);

                authorData.mora += finalWinnings;
                setScore.run(authorData);

                const timeOutWinEmbed = new EmbedBuilder()
                    .setTitle('⏰ انتهى الوقت! (تم الانسحاب تلقائياً)')
                    .setDescription(`لقد استغرقت وقتاً طويلاً، فتم سحب أرباحك الحالية: **${finalWinnings.toLocaleString()}** ${EMOJI_MORA} (بمضاعف **x${currentMultiplier}**)`)
                    .setColor(Colors.Green)
                    .setImage('https://i.postimg.cc/K8QBCQmS/download-1.gif');

                await msg.edit({ embeds: [timeOutWinEmbed], components: [] });
            } else {
                await msg.edit({ content: 'انتهى الوقت ولم تلعب. تم إلغاء اللعبة.', embeds: [], components: [] });
            }
        }
    });
}

async function playChallenge(interactionOrMessage, reply, author, opponents, bet, authorData, getScore, setScore, sql) {
    const channel = interactionOrMessage.channel;
    const guild = interactionOrMessage.guild;

    if (opponents.size > MAX_PLAYERS) {
        activeGames.delete(channel.id);
        return reply(`لا يمكنك تحدي أكثر من ${MAX_PLAYERS} لاعبين.`);
    }

    const players = [author, ...opponents.values()];
    const playerIDs = players.map(p => p.id);
    const totalPot = bet * players.length;

    for (const player of players) {
        if (player.id === author.id) continue;
        let playerData = getScore.get(player.id, guild.id);
        if (!playerData || playerData.mora < bet) {
            activeGames.delete(channel.id);
            return reply(`أحد اللاعبين (${player.displayName}) لا يملك مورا كافية لهذا الرهان!`);
        }
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roulette_pvp_accept').setLabel('قبول').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('roulette_pvp_decline').setLabel('رفض').setStyle(ButtonStyle.Danger)
    );
    const embed = new EmbedBuilder()
        .setTitle(`🔫 تحدي روليت جماعي!`)
        .setDescription(`${author} يتحدى ${opponents.map(o => o.toString()).join(', ')} لسباق مضاعفات الروليت.\n\nالرهان: **${bet}** ${EMOJI_MORA}\nالجائزة الكبرى: **${totalPot}** ${EMOJI_MORA}\n\nأعلى مضاعف يفوز بكل شيء!`)
        .setColor(Colors.Orange)
        .setImage('https://i.postimg.cc/J44F9YWS/gun.gif');

    const challengeMsg = await reply({ content: opponents.map(o => o.toString()).join(' '), embeds: [embed], components: [row] });

    const acceptedPlayers = new Set([author.id]);
    const requiredPlayers = opponents.map(o => o.id);
    const challengeCollector = challengeMsg.createMessageComponentCollector({ time: 60000 });

    challengeCollector.on('collect', async i => {
        if (!requiredPlayers.includes(i.user.id)) {
            return i.reply({ content: `هذا التحدي ليس لك.`, ephemeral: true });
        }
        if (i.customId === 'roulette_pvp_decline') {
            challengeCollector.stop('decline');
            return i.update({ content: `${i.member.displayName} رفض التحدي. تم إلغاء اللعبة.`, embeds: [], components: [] });
        }
        if (i.customId === 'roulette_pvp_accept') {
            acceptedPlayers.add(i.user.id);
            await i.reply({ content: `لقد قبلت التحدي! بانتظار باقي اللاعبين...`, ephemeral: true });
            if (acceptedPlayers.size === players.length) {
                challengeCollector.stop('start');
            }
        }
    });

    challengeCollector.on('end', async (collected, reason) => {
        if (reason !== 'start') {
            activeGames.delete(channel.id);
            return challengeMsg.edit({ content: 'انتهى الوقت ولم يوافق جميع اللاعبين. تم إلغاء التحدي.', embeds: [], components: [] });
        }

        for (const playerID of acceptedPlayers) {
            let data = getScore.get(playerID, guild.id);
            data.mora -= bet;
            setScore.run(data);
        }

        const gamePlayers = players.filter(p => acceptedPlayers.has(p.id));
        const MULTIPLIERS = getMultipliers(gamePlayers.length);

        const gameStates = new Map();
        gamePlayers.forEach(p => {
            gameStates.set(p.id, {
                chambers: setupChambers(),
                turn: 0,
                multiplier: 1.0,
                status: 'playing',
                player: p
            });
        });

        const gameRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('roulette_race_pull').setLabel('سحب الزناد').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('roulette_race_cashout').setLabel('انسحاب').setStyle(ButtonStyle.Success)
        );
        const gameEmbed = new EmbedBuilder()
            .setTitle('🔫 بدأ السباق!')
            .setDescription(`تم خصم **${bet}** من الجميع. لديكم 90 ثانية.\n\nمن يحقق أعلى مضاعف (أو ينجو 5 طلقات) يربح **${totalPot}** ${EMOJI_MORA}!`)
            .setColor(Colors.Red)
            .setImage('https://i.postimg.cc/J44F9YWS/gun.gif');

        await challengeMsg.edit({ content: gamePlayers.map(p => p.toString()).join(' '), embeds: [gameEmbed], components: [gameRow] });

        const gameCollector = challengeMsg.createMessageComponentCollector({ time: 90000 });

        gameCollector.on('collect', async i => {
            if (!gameStates.has(i.user.id) || gameStates.get(i.user.id).status !== 'playing') {
                return i.reply({ content: "أنت لست جزءاً من هذه اللعبة أو لقد خرجت بالفعل.", ephemeral: true });
            }

            const state = gameStates.get(i.user.id);

            if (i.customId === 'roulette_race_cashout') {
                state.status = 'cashed_out';
                await i.reply({ content: `لقد انسحبت. نتيجتك الحالية هي **x${state.multiplier}**.`, ephemeral: true });
            }

            if (i.customId === 'roulette_race_pull') {
                const shot = state.chambers[state.turn];

                if (shot === 1) {
                    state.status = 'dead';
                    state.multiplier = 0;
                    await i.reply({ content: `💥 طلقة! لقد خسرت رهانك وخرجت من السباق!`, ephemeral: true });
                } else {
                    state.multiplier = MULTIPLIERS[state.turn];
                    state.turn++;

                    if (state.turn === 5) {
                        state.status = 'max_win';
                        await i.reply({ content: `🏆 نجاة أسطورية! لقد وصلت للحد الأقصى **x${state.multiplier}**!`, ephemeral: true });
                    } else {
                        await i.reply({ content: `😮‍💨 نجاة! *كليك*... المضاعف القادم: x${MULTIPLIERS[state.turn]}`, ephemeral: true });
                    }
                }
            }

            const allDone = Array.from(gameStates.values()).every(s => s.status !== 'playing');
            if (allDone) {
                gameCollector.stop('all_done');
            }
        });

        gameCollector.on('end', (collected, reason) => {
            activeGames.delete(channel.id);

            let winner = null;
            let highestMultiplier = 0;
            let results = [];

            for (const state of gameStates.values()) {
                if (state.multiplier > highestMultiplier) {
                    highestMultiplier = state.multiplier;
                    winner = state.player;
                }
                results.push(`**${state.player.displayName}**: ${state.status === 'dead' ? 'خسر (x0)' : `x${state.multiplier}`}`);
            }

            let finalEmbed = new EmbedBuilder();
            if (winner && highestMultiplier > 1) {
                let winnerData = getScore.get(winner.id, guild.id);

                // ( 🌟 تمت إزالة المعزز نهائياً من اللعب الجماعي 🌟 )
                const finalWinnings = totalPot;

                winnerData.mora += finalWinnings;
                setScore.run(winnerData);

                let description = `لقد حقق أعلى مضاعf (${highestMultiplier}x) وربح الجائزة الكبرى **${totalPot}** ${EMOJI_MORA}!`;
                description += `\n\n**النتائج:**\n${results.join('\n')}`;

                finalEmbed.setTitle(`🏆 الفائز هو ${winner.displayName}!`)
                    .setDescription(description)
                    .setColor(Colors.Gold)
                    .setImage('https://i.postimg.cc/K8QBCQmS/download-1.gif')
                    .setThumbnail(winner.displayAvatarURL());
            } else {
                finalEmbed.setTitle('✥ انتهت اللعبة (لا يوجد فائز)!')
                    .setDescription(`لم يتمكن أحد من تحقيق مضاعف أعلى من 1.0x.\n\n**النتائج:**\n${results.join('\n')}\n\nتم إرجاع **${bet}** مورا إلى كل لاعب.`)
                    .setColor(Colors.Red)
                    .setImage('https://i.postimg.cc/3Np26Tx9/download.gif');

                for (const playerID of acceptedPlayers) {
                    let data = getScore.get(playerID, guild.id);
                    data.mora += bet;
                    setScore.run(data);
                }
            }

            challengeMsg.edit({ embeds: [finalEmbed], components: [] });
        });
    });
}
