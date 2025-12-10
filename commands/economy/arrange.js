const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder, Colors } = require('discord.js');

// محاولة استدعاء ملف الهاندلر لحساب البفات
let streakHandler;
try {
    streakHandler = require('../../streak-handler.js');
} catch (e) {
    console.warn("⚠️ لم يتم العثور على streak-handler.js في المسار المتوقع.");
}

// 1. قائمة اللاعبين النشطين (لمنع السبام في هذا الأمر تحديداً)
const activePlayers = new Set();
const cooldowns = new Map();

// 2. آيدي المالك (للتجاوز)
const OWNER_ID = "1145327691772481577";
const COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1 ساعة
const MIN_BET = 20;
const MAX_BET = 100; // الحد الأقصى

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes} دقيقة و ${seconds} ثانية`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('arrange')
        .setDescription('لعبة ترتيب الأرقام من الأصغر للأكبر.')
        .addIntegerOption(option => 
            option.setName('الرهان')
                .setDescription('مبلغ الرهان (اختياري)')
                .setMinValue(MIN_BET)
                .setRequired(false)
        ),

    name: 'arrange',
    aliases: ['رتب', 'ترتيب', 'ar'],
    category: "Economy",
    description: 'لعبة ترتيب الأرقام (رهان)',

    async execute(interactionOrMessage, args) {
        
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, user, guild, client, channel;
        let betInput;

        if (isSlash) {
            interaction = interactionOrMessage;
            user = interaction.user;
            guild = interaction.guild;
            client = interaction.client;
            channel = interaction.channel;
            betInput = interaction.options.getInteger('الرهان');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            user = message.author;
            guild = message.guild;
            client = message.client;
            channel = message.channel;
            if (args[0] && !isNaN(parseInt(args[0]))) betInput = parseInt(args[0]);
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

        const db = client.sql; 
        const MORA_EMOJI = client.EMOJI_MORA || '<:mora:1435647151349698621>';
        const userId = user.id;
        const guildId = guild.id;

        // ============================================================
        //  1. التحقق من السبام
        // ============================================================
        if (activePlayers.has(userId)) {
            return replyError("🚫 **لديك لعبة نشطة بالفعل!** أكمل اللعبة الحالية أولاً.");
        }

        // ============================================================
        //  2. التحقق من الكولداون
        // ============================================================
        if (userId !== OWNER_ID) {
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + COOLDOWN_MS;
                if (Date.now() < expirationTime) {
                    const timeLeft = expirationTime - Date.now();
                    return replyError(`<:stop:1436337453098340442> **ريــلاكــس!** يمكنك اللعب مجدداً بعد **${formatTime(timeLeft)}**.`);
                }
            }
        }

        let userData = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
        if (!userData) userData = { mora: 0 };

        // ============================================================
        //  3. دالة بدء اللعبة
        // ============================================================
        const startGame = async (finalBetAmount) => {
            try {
                // تحقق نهائي من الرصيد
                const currentMora = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId)?.mora || 0;
                
                if (currentMora < finalBetAmount) {
                     activePlayers.delete(userId);
                     return replyError(`💸 **رصيدك غير كافــي!**`);
                }
                
                if (finalBetAmount > MAX_BET) {
                    activePlayers.delete(userId);
                    return replyError(`🚫 الحد الأقصى للرهان هو **${MAX_BET}** ${MORA_EMOJI}`);
                }

                // خصم المبلغ فوراً
                db.prepare('UPDATE levels SET mora = mora - ? WHERE user = ? AND guild = ?').run(finalBetAmount, userId, guildId);
                
                // تسجيل الكولداون
                if (userId !== OWNER_ID) cooldowns.set(userId, Date.now());

                // إعداد الأرقام
                const numbersCount = 9;
                const randomNumbers = [];
                while (randomNumbers.length < numbersCount) {
                    let n = getRandomInt(1, 99);
                    if (!randomNumbers.includes(n)) randomNumbers.push(n);
                }

                // الحل الصحيح (مرتب)
                const sortedSolution = [...randomNumbers].sort((a, b) => a - b);
                let currentStep = 0; 

                // إنشاء الأزرار
                const buttons = randomNumbers.map(num => 
                    new ButtonBuilder()
                        .setCustomId(`num_${num}`)
                        .setLabel(`${num}`)
                        .setStyle(ButtonStyle.Secondary)
                );

                // خلط الأزرار للعرض
                const shuffledButtons = buttons.sort(() => Math.random() - 0.5);
                const row1 = new ActionRowBuilder().addComponents(shuffledButtons.slice(0, 3));
                const row2 = new ActionRowBuilder().addComponents(shuffledButtons.slice(3, 6));
                const row3 = new ActionRowBuilder().addComponents(shuffledButtons.slice(6, 9));

                const gameEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setThumbnail(user.displayAvatarURL())
                    .setTitle('❖ رتب الأرقام من الأصغر للأكبر')
                    .setDescription(`❖ الرهان: **${finalBetAmount} ${MORA_EMOJI}**\nاضغط الأزرار بالترتيب الصحيح قبل انتهاء الوقت!`)
                    .setFooter({ text: '❖ لــديــك 25 ثـانيــة' });

                // إرسال الرسالة (تعتمد على نوع الأمر)
                let gameMsg;
                if (isSlash) {
                    gameMsg = await interaction.editReply({ embeds: [gameEmbed], components: [row1, row2, row3] });
                } else {
                    gameMsg = await message.channel.send({ embeds: [gameEmbed], components: [row1, row2, row3] });
                }

                const startTime = Date.now();
                const collector = gameMsg.createMessageComponentCollector({ 
                    componentType: ComponentType.Button, 
                    time: 25000 
                });

                // دالة مساعدة لتحديث حالة زر معين في الصفوف
                const updateButtonState = (customId, style, disabled) => {
                    [row1, row2, row3].forEach(row => {
                        const btn = row.components.find(b => b.data.custom_id === customId);
                        if (btn) {
                            btn.setStyle(style);
                            btn.setDisabled(disabled);
                        }
                    });
                };

                // دالة لتعطيل كل الأزرار
                const disableAll = (style) => {
                    [row1, row2, row3].forEach(row => {
                        row.components.forEach(btn => {
                            btn.setDisabled(true);
                            if (btn.data.style === ButtonStyle.Secondary) btn.setStyle(style);
                        });
                    });
                };

                collector.on('collect', async i => {
                    if (i.user.id !== userId) return i.reply({ content: 'هذه اللعبة ليست لك!', ephemeral: true });

                    const clickedNum = parseInt(i.customId.split('_')[1]);
                    const correctNum = sortedSolution[currentStep];

                    if (clickedNum === correctNum) {
                        // إجابة صحيحة
                        currentStep++;
                        updateButtonState(i.customId, ButtonStyle.Success, true);

                        if (currentStep === sortedSolution.length) {
                            collector.stop('win'); // فاز
                        } else {
                            await i.update({ components: [row1, row2, row3] });
                        }
                    } else {
                        // إجابة خاطئة
                        updateButtonState(i.customId, ButtonStyle.Danger, true);
                        collector.stop('wrong');
                        await i.update({ components: [row1, row2, row3] });
                    }
                });

                collector.on('end', async (collected, reason) => {
                    activePlayers.delete(userId); // تحرير اللاعب

                    try {
                        if (reason === 'win') {
                            const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
                            
                            // حساب البفات
                            let moraMultiplier = 1.0;
                            // جلب الممبر كامل لحساب الرتب
                            const member = await guild.members.fetch(userId).catch(()=>null);
                            if (member && streakHandler && streakHandler.calculateMoraBuff) {
                                moraMultiplier = streakHandler.calculateMoraBuff(member, db);
                            }

                            // الربح = الرهان * 3 (كمثال)
                            const baseWinnings = finalBetAmount * 3; 
                            const totalWinnings = Math.floor(baseWinnings * moraMultiplier);
                            
                            // إضافة المبلغ
                            db.prepare('UPDATE levels SET mora = mora + ? WHERE user = ? AND guild = ?').run(totalWinnings, userId, guildId);

                            let buffText = "";
                            const buffPercent = Math.round((moraMultiplier - 1) * 100);
                            if (buffPercent > 0) buffText = ` (+${buffPercent}%)`;

                            const winEmbed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setThumbnail(user.displayAvatarURL())
                                .setTitle('❖ كفــوو عليك!')
                                .setDescription(`✶ رتبتها صح!\n⏱️ الوقت: **${timeTaken}ث**\n💰 ربـحـت: **${totalWinnings}** ${MORA_EMOJI}${buffText}`);

                            disableAll(ButtonStyle.Success);
                            // استخدام editReply لضمان عدم حدوث خطأ إذا كان الرد الأصلي Slash
                            if (gameMsg.editable) await gameMsg.edit({ embeds: [winEmbed], components: [row1, row2, row3] });
                            else if (isSlash) await interaction.editReply({ embeds: [winEmbed], components: [row1, row2, row3] });

                        } else {
                            let reasonText = reason === 'wrong' ? 'ضغطت رقم غلط!' : ' انتهى الوقت!';
                            const loseEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setThumbnail(user.displayAvatarURL())
                                .setTitle('💔 خـسـرت!')
                                .setDescription(`${reasonText}\nراحت عليك **${finalBetAmount} ${MORA_EMOJI}**\nالترتيب كان: \`${sortedSolution.join(' < ')}\``);

                            disableAll(ButtonStyle.Secondary);
                            if (gameMsg.editable) await gameMsg.edit({ embeds: [loseEmbed], components: [row1, row2, row3] });
                            else if (isSlash) await interaction.editReply({ embeds: [loseEmbed], components: [row1, row2, row3] });
                        }
                    } catch (err) {
                        console.error("خطأ أثناء إنهاء اللعبة:", err);
                    }
                });

            } catch (err) {
                activePlayers.delete(userId);
                console.error("خطأ أثناء بدء اللعبة:", err);
                replyError("حدث خطأ أثناء بدء اللعبة.");
            }
        };


        // ============================================================
        //  4. منطق الرهان التلقائي
        // ============================================================
        
        // إذا حدد مبلغ مباشرة
        if (betInput && !isNaN(betInput)) {
            if (betInput < MIN_BET) return replyError(`❌ **الحد الأدنى للرهان هو ${MIN_BET} ${MORA_EMOJI}**`);
            // حجز اللاعب فوراً
            activePlayers.add(userId);
            return startGame(betInput);
        }

        // إذا لم يحدد مبلغ (تلقائي)
        if (userData.mora < MIN_BET) {
            return replyError("💸 **ليس لديك مورا كافية للعب!**");
        }

        let proposedBet = 100;
        if (userData.mora < 100) proposedBet = userData.mora;

        // حجز اللاعب أثناء التأكيد
        activePlayers.add(userId);

        const autoBetEmbed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setDescription(`**هل تريد المراهنة تلقائياً بـ ${proposedBet} ${MORA_EMOJI} ؟**`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('arrange_auto_confirm').setLabel('مراهنة').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('arrange_auto_cancel').setLabel('إلغـاء').setStyle(ButtonStyle.Danger)
        );

        const confirmMsg = await reply({ embeds: [autoBetEmbed], components: [row], fetchReply: true });
        
        const filter = i => i.user.id === userId && (i.customId === 'arrange_auto_confirm' || i.customId === 'arrange_auto_cancel');
        
        try {
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });

            if (confirmation.customId === 'arrange_auto_cancel') {
                activePlayers.delete(userId); // تحرير
                await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                return;
            }

            if (confirmation.customId === 'arrange_auto_confirm') {
                await confirmation.deferUpdate();
                if (!isSlash) await confirmMsg.delete().catch(() => {});
                else await confirmation.editReply({ content: '✅', embeds: [], components: [] }); // مسح الرسالة
                
                // اللاعب مازال محجوزاً (activePlayers)، نبدأ اللعبة
                startGame(proposedBet);
            }

        } catch (e) {
            activePlayers.delete(userId); // تحرير عند انتهاء الوقت
            if (!isSlash) await confirmMsg.delete().catch(() => {});
            else await interaction.editReply({ content: '⏰ انتهى وقت الانتظار.', embeds: [], components: [] });
        }
    }
};
