const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

// 1. قائمة اللاعبين النشطين (لمنع السبام)
const activePlayers = new Set();
const cooldowns = new Map();

// 2. آيدي المالك (للتجاوز)
const OWNER_ID = "1145327691772481577"; 

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    name: 'arrange',
    aliases: ['رتب', 'ترتيب'],
    description: 'لعبة ترتيب الأرقام (رهان)',
    async execute(message, args) {
        
        const userId = message.author.id;
        const guildId = message.guild.id;
        const db = message.client.sql; 
        const MORA_EMOJI = message.client.EMOJI_MORA || '<:mora:1435647151349698621>';

        // دالة مساعدة لحذف اللاعب من القائمة النشطة عند الانتهاء
        const clearActive = () => activePlayers.delete(userId);

        // ============================================================
        //  1. التحقق من السبام (هل اللاعب مشغول؟)
        // ============================================================
        if (activePlayers.has(userId)) {
            return message.reply("🚫 **لديك عملية نشطة بالفعل!** أكمل اللعبة أو الرهان الحالي أولاً.");
        }

        // ============================================================
        //  2. التحقق من الكولداون (باستثناء المالك)
        // ============================================================
        if (userId !== OWNER_ID) {
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + 3600000;
                if (Date.now() < expirationTime) {
                    const timeLeft = (expirationTime - Date.now()) / 1000 / 60;
                    return message.reply(`❌ **انتظر قليلاً!** يمكنك اللعب مجدداً بعد **${timeLeft.toFixed(0)} دقيقة**.`);
                }
            }
        }

        // ============================================================
        //  3. حجز اللاعب (Lock)
        // ============================================================
        activePlayers.add(userId);


        // دالة تشغيل اللعبة
        const startGame = async (finalBetAmount) => {
            // التحقق من الرصيد والخصم
            const userCheck = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
            if (!userCheck || userCheck.mora < finalBetAmount) {
                 clearActive(); // فك الحجز
                 return message.reply(`💸 **رصيدك غير كافــي!** <:mirkk:1435648219488190525>`);
            }
            
            // خصم المبلغ
            db.prepare('UPDATE levels SET mora = mora - ? WHERE user = ? AND guild = ?').run(finalBetAmount, userId, guildId);

            // تفعيل الكولداون (فقط إذا لم يكن المالك)
            if (userId !== OWNER_ID) {
                cooldowns.set(userId, Date.now());
            }

            const numbersCount = 9;
            const randomNumbers = [];
            while (randomNumbers.length < numbersCount) {
                let n = getRandomInt(1, 99);
                if (!randomNumbers.includes(n)) randomNumbers.push(n);
            }

            const sortedSolution = [...randomNumbers].sort((a, b) => a - b);
            let currentStep = 0; 

            const buttons = randomNumbers.map(num => 
                new ButtonBuilder()
                    .setCustomId(`num_${num}`)
                    .setLabel(`${num}`)
                    .setStyle(ButtonStyle.Secondary)
            );

            const shuffledButtons = buttons.sort(() => Math.random() - 0.5);
            const row1 = new ActionRowBuilder().addComponents(shuffledButtons.slice(0, 3));
            const row2 = new ActionRowBuilder().addComponents(shuffledButtons.slice(3, 6));
            const row3 = new ActionRowBuilder().addComponents(shuffledButtons.slice(6, 9));

            const gameEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setTitle('🔢 رتب الأرقام من الأصغر للأكبر')
                .setDescription(`الرهان: **${finalBetAmount} ${MORA_EMOJI}**\nاضغط الأزرار بالترتيب الصحيح قبل انتهاء الوقت!`)
                .setFooter({ text: 'لديك 20 ثانية' });

            const gameMsg = await message.channel.send({ 
                embeds: [gameEmbed], 
                components: [row1, row2, row3] 
            });

            const startTime = Date.now();
            const collector = gameMsg.createMessageComponentCollector({ 
                componentType: ComponentType.Button, 
                time: 20000 
            });

            const updateButtonInRows = (customId, style, disabled = false) => {
                const rows = [row1, row2, row3];
                for (const row of rows) {
                    const btnIndex = row.components.findIndex(b => b.data.custom_id === customId);
                    if (btnIndex !== -1) {
                        row.components[btnIndex].setStyle(style);
                        if (disabled) row.components[btnIndex].setDisabled(true);
                        return;
                    }
                }
            };

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
                    currentStep++;
                    updateButtonInRows(i.customId, ButtonStyle.Success, true);

                    if (currentStep === sortedSolution.length) {
                        collector.stop('win');
                    } else {
                        await i.update({ components: [row1, row2, row3] });
                    }
                } else {
                    updateButtonInRows(i.customId, ButtonStyle.Danger, false);
                    collector.stop('wrong');
                    await i.update({ components: [row1, row2, row3] });
                }
            });

            collector.on('end', async (collected, reason) => {
                // فك الحجز في نهاية اللعبة
                clearActive();

                if (reason === 'win') {
                    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
                    
                    let raceBonusPercent = 0.00; 
                    // if (message.member.roles.cache.has('ROLE_ID')) raceBonusPercent = 0.10;

                    const baseProfit = finalBetAmount; 
                    const extraBonus = Math.floor(baseProfit * raceBonusPercent);
                    const totalPrize = finalBetAmount + baseProfit + extraBonus; 

                    db.prepare('UPDATE levels SET mora = mora + ? WHERE user = ? AND guild = ?').run(totalPrize, userId, guildId);

                    const winEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                        .setTitle('🎉 كفوو عليك!')
                        .setDescription(`جبتها صح!\n⏱️ الوقت: **${timeTaken}ث**\n💰 الربح: **${baseProfit}** + مكافأة **${extraBonus}**\nالمجموع: **${totalPrize} ${MORA_EMOJI}**`);

                    disableAll(ButtonStyle.Success);
                    await gameMsg.edit({ embeds: [winEmbed], components: [row1, row2, row3] });

                } else {
                    let reasonText = reason === 'wrong' ? 'ضغطت رقم غلط <:catla:1437335118153781360>' : '<:catla:1437335118153781360> انتهى الوقت!';
                    const loseEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                        .setTitle('❌ خسرت!')
                        .setDescription(`${reasonText}\nراحت عليك **${finalBetAmount} ${MORA_EMOJI}**\nالترتيب كان: \`${sortedSolution.join(' < ')}\``);

                    disableAll(ButtonStyle.Secondary);
                    await gameMsg.edit({ embeds: [loseEmbed], components: [row1, row2, row3] });
                }
            });
        };

        // ============================================================
        //  بداية معالجة الأمر (Input Logic)
        // ============================================================
        let betAmount = parseInt(args[0]);

        // 1. إذا حدد رقم مباشرة
        if (betAmount && !isNaN(betAmount)) {
            if (betAmount <= 0) {
                clearActive(); return message.reply("❌ **حدد مبلغ رهان صحيح.**");
            }
            if (betAmount > 100) {
                clearActive(); return message.reply(`❌ **الحد الأقصى للرهان هو 100 ${MORA_EMOJI}**`);
            }
            return startGame(betAmount);
        }

        // 2. نظام الرهان التلقائي (Auto Bet)
        let userData = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
        
        // التحقق من الرصيد قبل عرض الأزرار
        if (!userData || userData.mora < 1) {
            clearActive();
            return message.reply(" **ليس لديك مورا كافية للعب!** <:catla:1437335118153781360>");
        }

        let proposedBet = 100;
        if (userData.mora < 100) proposedBet = userData.mora;

        const autoBetEmbed = new EmbedBuilder()
            .setColor('#2F3136')
            .setDescription(`**هل تريد المراهنة تلقائياً بـ ${proposedBet} ${MORA_EMOJI} ؟ <:2BCrikka:1437806481071411391>**`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('arrange_auto_confirm').setLabel('مراهنة').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('arrange_auto_cancel').setLabel('إلغـاء').setStyle(ButtonStyle.Danger)
        );

        const confirmMsg = await message.reply({ embeds: [autoBetEmbed], components: [row] });
        
        const filter = i => i.user.id === userId && (i.customId === 'arrange_auto_confirm' || i.customId === 'arrange_auto_cancel');
        
        try {
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });

            if (confirmation.customId === 'arrange_auto_cancel') {
                clearActive(); // فك الحجز عند الإلغاء
                await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                return;
            }

            if (confirmation.customId === 'arrange_auto_confirm') {
                await confirmation.update({ content: `✅ تم قبول الرهان: **${proposedBet}** ${MORA_EMOJI}`, embeds: [], components: [] });
                // اللعبة تبدأ والحجز يظل مستمراً حتى تنتهي اللعبة
                startGame(proposedBet);
            }

        } catch (e) {
            clearActive(); // فك الحجز عند انتهاء وقت الانتظار
            await confirmMsg.edit({ content: '⏰ انتهى وقت الانتظار.', embeds: [], components: [] }).catch(() => {});
        }
    }
};
