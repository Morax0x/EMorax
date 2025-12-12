const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, Colors } = require('discord.js');
const shopItems = require('../../json/shop-items.json');
const farmAnimals = require('../../json/farm-animals.json');
const marketItems = require('../../json/market-items.json');
const questsConfig = require('../../json/quests-config.json');

const EMOJI_MORA = '<:mora:1435647151349698621>';

// --- دوال مساعدة للوقت والنصوص ---
function getWeekStartDateString() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); 
    const diff = now.getUTCDate() - (dayOfWeek + 2) % 7; 
    const friday = new Date(now.setUTCDate(diff));
    friday.setUTCHours(0, 0, 0, 0); 
    return friday.toISOString().split('T')[0];
}

function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

// 🔥 دالة توحيد النصوص العربية 🔥
function normalize(str) {
    if (!str) return "";
    return str.toString().toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    name: 'admin-tools',
    description: 'لوحة التحكم الشاملة',
    aliases: ['ادمن', 'admin', 'تعديل-ادمن', 'ادوات-ادمن', 'control'],
    category: 'Admin',

    async execute(message, args) {
        const client = message.client;
        const sql = client.sql;

        // 1. التحقق من الصلاحيات
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return; 
        }

        // 2. التأكد من وجود عمود حالة السوق
        try { 
            sql.prepare("ALTER TABLE settings ADD COLUMN marketStatus TEXT DEFAULT 'normal'").run(); 
        } catch (e) {}

        const subcommand = args[0] ? args[0].toLowerCase() : null;
        
        // استثناء أوامر السوق من شرط المنشن
        if (['market-status', 'حالة-السوق', 'market-crash', 'انهيار-السوق', 'market-boom', 'انعاش-السوق', 'set-price', 'تحديد-سعر', 'reset-market', 'تصفير-السوق'].includes(subcommand)) {
            await this.handleMarketCommands(message, sql, subcommand, args);
            return;
        }

        const targetUser = message.mentions.users.first() || client.users.cache.get(args[1]);
        const embed = new EmbedBuilder().setColor(Colors.Green).setTimestamp();

        if (!targetUser) {
            return message.reply({ embeds: [this.getHelpEmbed()] });
        }

        let targetMember;
        try {
            targetMember = await message.guild.members.fetch(targetUser.id);
        } catch (e) {
             return message.reply("❌ لا يمكن العثور على هذا العضو.");
        }

        switch (subcommand) {
            case 'set-media-streak':
            case 'ضبط-ميديا-ستريك':
                await this.setMediaStreak(message, sql, targetUser, args[2], embed);
                break;
            case 'give-media-shield':
            case 'إعطاء-درع-ميديا':
            case 'اعطاء-درع-ميديا':
                await this.giveMediaShield(message, sql, targetUser, embed);
                break;
            case 'remove-media-shield':
            case 'إزالة-درع-ميديا':
            case 'ازالة-درع-ميديا':
                await this.removeMediaShield(message, sql, targetUser, embed);
                break;

            case 'give-item':
            case 'إعطاء-عنصر':
            case 'اعطاء-عنصر':
                await this.giveItem(message, client, sql, targetUser, args, embed);
                break;
            case 'remove-item':
            case 'إزالة-عنصر':
            case 'ازالة-عنصر':
                await this.removeItem(message, client, sql, targetUser, args, embed);
                break;

            case 'give-achievement':
            case 'اعطاء-انجاز':
                await this.giveAchievement(message, client, sql, targetUser, targetMember, args, embed);
                break;
            case 'remove-achievement':
            case 'ازالة-انجاز':
                await this.removeAchievement(message, sql, targetUser, args, embed);
                break;
            case 'give-daily-quest':
            case 'اعطاء-مهمة-يومية':
                await this.giveQuest(message, client, sql, targetUser, targetMember, args, 'daily', embed);
                break;
            case 'give-weekly-quest':
            case 'اعطاء-مهمة-اسبوعية':
                await this.giveQuest(message, client, sql, targetUser, targetMember, args, 'weekly', embed);
                break;

            case 'set-stat':
            case 'ضبط-احصائية':
                await this.setStat(message, client, sql, targetUser, targetMember, args[2], args[3], embed);
                break;
            case 'add-mora':
            case 'اضافة-مورا':
                await this.modifyEconomy(message, client, sql, targetUser, args[2], 'add', 'mora', embed);
                break;
            case 'remove-mora':
            case 'خصم-مورا':
                await this.modifyEconomy(message, client, sql, targetUser, args[2], 'remove', 'mora', embed);
                break;
            case 'add-xp':
            case 'اضافة-خبرة':
                await this.modifyEconomy(message, client, sql, targetUser, args[2], 'add', 'xp', embed);
                break;
            case 'reset-user':
            case 'تصفير-المستخدم':
                await this.resetUser(message, client, sql, targetUser, embed);
                break;
            
            case 'check':
            case 'فحص':
            case 'معلومات':
                await this.checkUser(message, client, sql, targetUser, embed);
                break;

            default:
                message.reply({ embeds: [this.getHelpEmbed()] });
        }
    },

    getHelpEmbed() {
        return new EmbedBuilder()
            .setTitle('🛠️ لوحة التحكم')
            .setColor(Colors.DarkGrey)
            .setDescription(
                "**التحكم بالسوق:**\n" +
                "`-ادمن حالة-السوق [ركود/ازدهار/طبيعي]`\n" +
                "`-ادمن انهيار-السوق` (خسف الأسعار)\n" +
                "`-ادمن انعاش-السوق` (رفع الأسعار)\n" +
                "`-ادمن تصفير-السوق` (بيع إجباري لجميع الأصول وتعويض الأعضاء)\n" +
                "`-ادمن تحديد-سعر [ID] [السعر]`\n\n" +

                "**التحكم بالأعضاء:**\n" +
                "`-ادمن فحص @user` (عرض شامل لبيانات العضو)\n" +
                "`-ادمن ضبط-ميديا-ستريك @user [العدد]`\n" +
                "`-ادمن اعطاء-درع-ميديا @user`\n" +
                "`-ادمن اعطاء-عنصر @user [اسم العنصر] [الكمية]`\n" +
                "`-ادمن اضافة-مورا @user [المبلغ]`\n" +
                "`-ادمن اضافة-خبرة @user [القدر]`\n" +
                "`-ادمن اعطاء-انجاز @user [اسم الانجاز]`"
            );
    },

    async checkUser(message, client, sql, targetUser, embed) {
        const guildID = message.guild.id;
        const userID = targetUser.id;

        const userData = client.getLevel.get(userID, guildID) || {};
        const streakData = sql.prepare("SELECT * FROM streaks WHERE guildID = ? AND userID = ?").get(guildID, userID) || {};
        const mediaStreakData = sql.prepare("SELECT * FROM media_streaks WHERE guildID = ? AND userID = ?").get(guildID, userID) || {};
        const portfolio = sql.prepare("SELECT * FROM user_portfolio WHERE guildID = ? AND userID = ?").all(guildID, userID);
        const farm = sql.prepare("SELECT animalID, COUNT(*) as count FROM user_farm WHERE guildID = ? AND userID = ? GROUP BY animalID").all(guildID, userID);
        const achievements = sql.prepare("SELECT achievementID FROM user_achievements WHERE guildID = ? AND userID = ?").all(guildID, userID);

        embed.setTitle(`📋 تقرير فحص: ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '💰 الاقتصاد', value: `مورا: **${(userData.mora || 0).toLocaleString()}**\nبنك: **${(userData.bank || 0).toLocaleString()}**\nXP: **${(userData.xp || 0).toLocaleString()}** (Lv. ${userData.level || 1})`, inline: true },
                { name: '🔥 الستريك', value: `شات: **${streakData.streakCount || 0}** (Shield: ${streakData.hasItemShield ? '✅' : '❌'})\nميديا: **${mediaStreakData.streakCount || 0}** (Shield: ${mediaStreakData.hasItemShield ? '✅' : '❌'})`, inline: true },
                { name: '🛡️ الحماية', value: `حارس شخصي: **${userData.hasGuard || 0}** شحنة`, inline: true },
                { name: '📈 المحفظة', value: portfolio.length > 0 ? portfolio.map(p => `${p.itemID}: ${p.quantity}`).join(', ') : 'لا يوجد', inline: false },
                { name: '🐄 المزرعة', value: farm.length > 0 ? farm.map(a => `${a.animalID}: ${a.count}`).join(', ') : 'لا يوجد', inline: false },
                { name: '🏆 الإنجازات', value: `عدد المكتمل: **${achievements.length}**`, inline: true }
            );

        await message.reply({ embeds: [embed] });
    },

    // =========================================================
    // 📊 دوال السوق
    // =========================================================
    async handleMarketCommands(message, sql, subcommand, args) {
        const embed = new EmbedBuilder().setColor(Colors.Gold).setTimestamp();
        const guildID = message.guild.id;

        if (subcommand === 'market-status' || subcommand === 'حالة-السوق') {
            const status = args[1]; 
            if (!['recession', 'boom', 'normal', 'ركود', 'ازدهار', 'طبيعي'].includes(status)) {
                return message.reply("❌ الحالات المتاحة: `ركود`، `ازدهار`، `طبيعي`.");
            }
            
            let statusKey = 'normal';
            if (['recession', 'ركود'].includes(status)) statusKey = 'recession';
            if (['boom', 'ازدهار'].includes(status)) statusKey = 'boom';

            sql.prepare("INSERT OR IGNORE INTO settings (guild) VALUES (?)").run(guildID);
            sql.prepare("UPDATE settings SET marketStatus = ? WHERE guild = ?").run(statusKey, guildID);

            let statusText = statusKey === 'recession' ? '📉 ركود اقتصادي' : (statusKey === 'boom' ? '📈 ازدهار اقتصادي' : '⚖️ وضع طبيعي');
            embed.setDescription(`✅ تم تحديث حالة السوق إلى: **${statusText}**`);
            await message.reply({ embeds: [embed] });
        } 
        
        else if (subcommand === 'market-crash' || subcommand === 'انهيار-السوق') {
            const allItems = sql.prepare("SELECT * FROM market_items").all();
            const updateStmt = sql.prepare("UPDATE market_items SET currentPrice = ?, lastChangePercent = ? WHERE id = ?");
            
            let report = [];
            for (const item of allItems) {
                const dropPercent = (Math.random() * 0.20) + 0.20; 
                const newPrice = Math.max(10, Math.floor(item.currentPrice * (1 - dropPercent)));
                const changePercent = ((newPrice - item.currentPrice) / item.currentPrice);
                
                updateStmt.run(newPrice, changePercent.toFixed(2), item.id);
                report.push(`${item.name}: ${item.currentPrice.toLocaleString()} ➔ ${newPrice.toLocaleString()}`);
            }
            
            embed.setColor(Colors.Red).setTitle('📉 انهيار السوق!').setDescription(`\`\`\`\n${report.join('\n')}\n\`\`\``);
            await message.reply({ embeds: [embed] });
        }

        else if (subcommand === 'market-boom' || subcommand === 'انعاش-السوق') {
            const allItems = sql.prepare("SELECT * FROM market_items").all();
            const updateStmt = sql.prepare("UPDATE market_items SET currentPrice = ?, lastChangePercent = ? WHERE id = ?");
            
            let report = [];
            for (const item of allItems) {
                const risePercent = (Math.random() * 0.20) + 0.15; 
                const newPrice = Math.floor(item.currentPrice * (1 + risePercent));
                const changePercent = ((newPrice - item.currentPrice) / item.currentPrice);
                
                updateStmt.run(newPrice, changePercent.toFixed(2), item.id);
                report.push(`${item.name}: ${item.currentPrice.toLocaleString()} ➔ ${newPrice.toLocaleString()}`);
            }
            
            embed.setColor(Colors.Gold).setTitle('📈 انتعاش السوق!').setDescription(`\`\`\`\n${report.join('\n')}\n\`\`\``);
            await message.reply({ embeds: [embed] });
        }

        else if (subcommand === 'set-price' || subcommand === 'تحديد-سعر') {
            const itemID = args[1]; 
            const price = parseInt(args[2]);

            if (!itemID || isNaN(price)) return message.reply("❌ الاستخدام: `-ادمن تحديد-سعر [ID/الاسم] [السعر]`");

            const item = marketItems.find(i => normalize(i.name) === normalize(itemID) || i.id.toLowerCase() === itemID.toLowerCase());
            
            if (!item) return message.reply("❌ السهم غير موجود.");

            const dbItem = sql.prepare("SELECT * FROM market_items WHERE id = ?").get(item.id);
            const currentPrice = dbItem ? dbItem.currentPrice : item.price;

            const changePercent = ((price - currentPrice) / currentPrice).toFixed(2);
            sql.prepare("UPDATE market_items SET currentPrice = ?, lastChangePercent = ? WHERE id = ?").run(price, changePercent, item.id);

            embed.setDescription(`✅ تم تحديد سعر **${item.name}** يدوياً بـ **${price.toLocaleString()}**.`);
            await message.reply({ embeds: [embed] });
        }

        // 🔥 الأمر الجديد: تصفير السوق وإنعاشه مع إشعارات الكازينو 🔥
        else if (subcommand === 'reset-market' || subcommand === 'تصفير-السوق') {
            
            // 1. التحقق من وجود روم الكازينو
            const settings = sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?").get(guildID);
            const casinoChannel = settings && settings.casinoChannelID ? message.guild.channels.cache.get(settings.casinoChannelID) : null;

            if (!casinoChannel) {
                return message.reply("❌ لم يتم تحديد روم الكازينو! استخدم أمر تحديد روم الكازينو أولاً (`-setcasino`).");
            }

            const msg = await message.reply("⚠️ **جاري حساب قيمة الأصول وبيعها لجميع الأعضاء وإرسال الإشعارات... يرجى الانتظار.**");

            // 2. جلب جميع المحافظ
            const allPortfolios = sql.prepare("SELECT * FROM user_portfolio WHERE guildID = ?").all(guildID);
            
            if (allPortfolios.length === 0) {
                return msg.edit("❌ لا توجد أصول في السوق للبيع.");
            }

            // 3. جلب الأسعار الحالية
            const dbItems = sql.prepare("SELECT * FROM market_items").all();
            const priceMap = new Map();
            const nameMap = new Map();
            
            marketItems.forEach(i => {
                priceMap.set(i.id, i.price);
                nameMap.set(i.id, i.name);
            });
            dbItems.forEach(i => priceMap.set(i.id, i.currentPrice));

            // 4. تجميع البيانات لكل مستخدم
            const userAssets = {}; // { userID: { total: 0, items: ["name x5: 500", ...] } }

            for (const entry of allPortfolios) {
                const price = priceMap.get(entry.itemID);
                const name = nameMap.get(entry.itemID) || entry.itemID;
                
                if (!price) continue; 

                const value = Math.floor(price * entry.quantity);
                
                if (!userAssets[entry.userID]) {
                    userAssets[entry.userID] = { total: 0, items: [] };
                }

                userAssets[entry.userID].total += value;
                userAssets[entry.userID].items.push(`✶ ${name} (x${entry.quantity}): **${value.toLocaleString()}**`);
            }

            // 5. التنفيذ (تحديث الرصيد + إرسال الرسائل + الحذف)
            const transaction = sql.transaction(() => {
                const updateMora = sql.prepare("UPDATE levels SET mora = mora + ? WHERE user = ? AND guild = ?");
                
                for (const [userID, data] of Object.entries(userAssets)) {
                    // حساب التعويض المخفي (0.05%)
                    const bonus = Math.floor(data.total * 0.0005);
                    const finalRefund = data.total + bonus;

                    // تحديث الرصيد
                    updateMora.run(finalRefund, userID, guildID);
                }

                // حذف جميع المحافظ
                sql.prepare("DELETE FROM user_portfolio WHERE guildID = ?").run(guildID);
                // إعادة حالة السوق
                sql.prepare("UPDATE settings SET marketStatus = 'normal' WHERE guild = ?").run(guildID);
            });

            transaction();

            // 6. إرسال الإشعارات في الكازينو (خارج الترانزاكشن لتجنب البطء)
            for (const [userID, data] of Object.entries(userAssets)) {
                const bonus = Math.floor(data.total * 0.0005);
                const finalRefund = data.total + bonus;

                const userEmbed = new EmbedBuilder()
                    .setTitle('❖ مــرســوم امبـراطـوري !')
                    .setColor("Random") // لون عشوائي
                    .setThumbnail('https://i.postimg.cc/CdpdVfxQ/5902480522066201408-120-removebg-preview.png') // الصورة الصغيرة
                    .setImage('https://media.discordapp.net/attachments/1394280285289320550/1432409477272965190/line.png?ex=690eca88&is=690d7908&hm=b21b91d8e7b66da4c28a29dd513bd1104c76ab6c875f23cd9405daf3ce48c050&=&format=webp&quality=lossless')
                    .setDescription(
                        `بـ أمـر من الامبـراطـور تـم بيـع كـل اصولـك بـسبب الركود الحالي بسوق الاسهم والاستثمارات لننتقل للمرحلة التالية من انعاش السـوق ستحصـل عـلى تعويض بمقدار ممتلكاتك الحالية\n\n` +
                        `**✶ الاصـول المبـاعـة:**\n` +
                        data.items.join('\n') + 
                        `\n\n**المجموع:**\n` +
                        `**${finalRefund.toLocaleString()}** ${EMOJI_MORA}`
                    );

                await casinoChannel.send({ content: `<@${userID}>`, embeds: [userEmbed] }).catch(() => {});
                // تأخير بسيط لتجنب الريت ليميت (اختياري)
                await new Promise(res => setTimeout(res, 500));
            }

            await msg.edit(`✅ **تمت العملية بنجاح!** تم بيع الأصول وتعويض ${Object.keys(userAssets).length} عضو، وإرسال الإشعارات في ${casinoChannel}.`);
        }
    },

    // =========================================================
    // 💰 دوال الاقتصاد
    // =========================================================
    async modifyEconomy(message, client, sql, targetUser, amountArg, type, currency, embed) {
        const amount = parseInt(amountArg);
        if (isNaN(amount) || amount <= 0) return message.reply("❌ رقم غير صالح.");

        let userData = client.getLevel.get(targetUser.id, message.guild.id);
        if (!userData) userData = { ...client.defaultData, user: targetUser.id, guild: message.guild.id };

        if (currency === 'mora') {
            if (type === 'add') userData.mora += amount;
            else userData.mora = Math.max(0, userData.mora - amount);
            embed.setDescription(`✅ **${type === 'add' ? 'تم إضافة' : 'تم خصم'}** \`${amount.toLocaleString()}\` مورا لـ ${targetUser}.`);
        } else if (currency === 'xp') {
            if (type === 'add') {
                userData.xp += amount;
                userData.totalXP += amount;
                const nextXP = 5 * (userData.level ** 2) + (50 * userData.level) + 100;
                if (userData.xp >= nextXP) {
                    userData.level++;
                    userData.xp -= nextXP;
                }
            }
            embed.setDescription(`✅ **تم إضافة** \`${amount.toLocaleString()}\` XP لـ ${targetUser}.`);
        }

        client.setLevel.run(userData);
        await message.reply({ embeds: [embed] });
    },

    async resetUser(message, client, sql, targetUser, embed) {
        const guildID = message.guild.id;
        const userID = targetUser.id;

        sql.prepare("DELETE FROM levels WHERE user = ? AND guild = ?").run(userID, guildID);
        sql.prepare("DELETE FROM user_portfolio WHERE userID = ? AND guildID = ?").run(userID, guildID);
        sql.prepare("DELETE FROM user_farm WHERE userID = ? AND guildID = ?").run(userID, guildID);
        sql.prepare("DELETE FROM user_achievements WHERE userID = ? AND guildID = ?").run(userID, guildID);
        client.setLevel.run({ ...client.defaultData, user: userID, guild: guildID });

        embed.setColor(Colors.DarkRed).setDescription(`☣️ **تم تصفير حساب ${targetUser} بالكامل!**`);
        await message.reply({ embeds: [embed] });
    },

    // =========================================================
    // 🔥 دوال الستريك
    // =========================================================
    async setMediaStreak(message, sql, targetUser, countArg, embed) {
        const count = parseInt(countArg);
        if (isNaN(count) || count < 0) return message.reply("❌ رقم غير صالح.");
        
        const guildID = message.guild.id;
        const userID = targetUser.id;
        const id = `${guildID}-${userID}`;
        let streakData = sql.prepare("SELECT * FROM media_streaks WHERE id = ?").get(id);
        
        if (!streakData) {
            streakData = { id, guildID, userID, streakCount: count, lastMediaTimestamp: Date.now(), hasGracePeriod: 1, hasItemShield: 0, hasReceivedFreeShield: 1, dmNotify: 1, highestStreak: count };
        } else {
            streakData.streakCount = count;
            if (count > streakData.highestStreak) streakData.highestStreak = count;
        }
        
        sql.prepare(`INSERT OR REPLACE INTO media_streaks (id, guildID, userID, streakCount, lastMediaTimestamp, hasGracePeriod, hasItemShield, hasReceivedFreeShield, dmNotify, highestStreak) VALUES (@id, @guildID, @userID, @streakCount, @lastMediaTimestamp, @hasGracePeriod, @hasItemShield, @hasReceivedFreeShield, @dmNotify, @highestStreak)`).run(streakData);
        
        embed.setDescription(`✅ تم ضبط ستريك الميديا لـ ${targetUser} إلى **${count}**.`);
        await message.reply({ embeds: [embed] });
    },

    async giveMediaShield(message, sql, targetUser, embed) {
        const id = `${message.guild.id}-${targetUser.id}`;
        const streakData = sql.prepare("SELECT * FROM media_streaks WHERE id = ?").get(id);
        
        if (streakData && streakData.hasItemShield) return message.reply("ℹ️ يمتلك درعاً بالفعل.");
        
        if (!streakData) {
            sql.prepare(`INSERT INTO media_streaks (id, guildID, userID, hasItemShield) VALUES (?, ?, ?, 1)`).run(id, message.guild.id, targetUser.id);
        } else {
            sql.prepare("UPDATE media_streaks SET hasItemShield = 1 WHERE id = ?").run(id);
        }
        
        embed.setDescription(`✅ تم إعطاء درع ستريك ميديا لـ ${targetUser}.`);
        await message.reply({ embeds: [embed] });
    },

    async removeMediaShield(message, sql, targetUser, embed) {
        const id = `${message.guild.id}-${targetUser.id}`;
        sql.prepare("UPDATE media_streaks SET hasItemShield = 0 WHERE id = ?").run(id);
        embed.setDescription(`✅ تم إزالة درع ستريك الميديا من ${targetUser}.`);
        await message.reply({ embeds: [embed] });
    },

    // =========================================================
    // 🎒 دوال العناصر (بحث ذكي بالاسم)
    // =========================================================
    findItem(nameOrID) {
        const input = normalize(nameOrID);
        
        // البحث في المتجر (أولوية للعناصر الخاصة)
        let item = shopItems.find(i => normalize(i.name) === input || i.id.toLowerCase() === nameOrID.toLowerCase());
        if (item && !marketItems.some(m => m.id === item.id) && !farmAnimals.some(f => f.id === item.id)) {
             return { ...item, type: 'shop_special' };
        }

        // البحث في السوق
        item = marketItems.find(i => normalize(i.name) === input || i.id.toLowerCase() === nameOrID.toLowerCase());
        if (item) return { ...item, type: 'market' };

        // البحث في المزرعة
        item = farmAnimals.find(i => normalize(i.name) === input || i.id.toLowerCase() === nameOrID.toLowerCase());
        if (item) return { ...item, type: 'farm' };

        return null;
    },

    async giveItem(message, client, sql, targetUser, args, embed) {
        // محاولة استخراج الكمية (آخر مدخل إذا كان رقم)
        let quantity = 1;
        let itemNameRaw = "";
        
        const lastArg = args[args.length - 1];
        if (!isNaN(parseInt(lastArg))) {
            quantity = parseInt(lastArg);
            itemNameRaw = args.slice(2, -1).join(' ');
        } else {
            itemNameRaw = args.slice(2).join(' ');
        }

        if (!itemNameRaw || quantity <= 0) return message.reply("❌ الاستخدام: `-ادمن اعطاء-عنصر @user [الاسم] [الكمية]`");

        const item = this.findItem(itemNameRaw);
        if (!item) return message.reply(`❌ لم يتم العثور على عنصر باسم "${itemNameRaw}".`);

        const guildID = message.guild.id;
        const userID = targetUser.id;

        // منطق الإضافة حسب النوع
        if (item.type === 'market') {
            const pfItem = sql.prepare("SELECT * FROM user_portfolio WHERE userID = ? AND guildID = ? AND itemID = ?").get(userID, guildID, item.id);
            if (pfItem) sql.prepare("UPDATE user_portfolio SET quantity = quantity + ? WHERE id = ?").run(quantity, pfItem.id);
            else sql.prepare("INSERT INTO user_portfolio (guildID, userID, itemID, quantity) VALUES (?, ?, ?, ?)").run(guildID, userID, item.id, quantity);
            embed.setDescription(`✅ تم إضافة **${quantity}** × **${item.name}** لمحفظة ${targetUser}.`);
        } 
        else if (item.type === 'farm') {
            const now = Date.now();
            const stmt = sql.prepare("INSERT INTO user_farm (guildID, userID, animalID, purchaseTimestamp, lastCollected) VALUES (?, ?, ?, ?, ?)");
            for (let i = 0; i < quantity; i++) stmt.run(guildID, userID, item.id, now, now);
            embed.setDescription(`✅ تم إضافة **${quantity}** × **${item.name}** لمزرعة ${targetUser}.`);
        }
        else if (item.type === 'shop_special') {
            if (item.id === 'personal_guard_1d') {
                let ud = client.getLevel.get(userID, guildID) || { ...client.defaultData, user: userID, guild: guildID };
                ud.hasGuard = (ud.hasGuard || 0) + quantity;
                client.setLevel.run(ud);
                embed.setDescription(`✅ تم إضافة **${quantity}** شحنات حماية لـ ${targetUser}.`);
            }
            else if (item.id === 'streak_shield') {
                sql.prepare(`INSERT INTO streaks (id, guildID, userID, hasItemShield) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET hasItemShield=1`).run(`${guildID}-${userID}`, guildID, userID);
                embed.setDescription(`✅ تم تفعيل **درع الستريك** لـ ${targetUser}.`);
            }
            else if (item.id === 'streak_shield_media') {
                await this.giveMediaShield(message, sql, targetUser, embed);
                return;
            }
            else {
                return message.reply("❌ هذا العنصر لا يمكن إعطاؤه يدوياً.");
            }
        }
        await message.reply({ embeds: [embed] });
    },

    async removeItem(message, client, sql, targetUser, args, embed) {
        let quantity = 1;
        let itemNameRaw = "";
        
        const lastArg = args[args.length - 1];
        if (!isNaN(parseInt(lastArg))) {
            quantity = parseInt(lastArg);
            itemNameRaw = args.slice(2, -1).join(' ');
        } else {
            itemNameRaw = args.slice(2).join(' ');
        }

        if (!itemNameRaw || quantity <= 0) return message.reply("❌ الاستخدام: `-ادمن ازالة-عنصر @user [الاسم] [الكمية]`");

        const item = this.findItem(itemNameRaw);
        if (!item) return message.reply(`❌ لم يتم العثور على عنصر باسم "${itemNameRaw}".`);

        const guildID = message.guild.id;
        const userID = targetUser.id;

        if (item.type === 'market') {
            const pfItem = sql.prepare("SELECT * FROM user_portfolio WHERE userID = ? AND guildID = ? AND itemID = ?").get(userID, guildID, item.id);
            if (!pfItem || pfItem.quantity < quantity) return message.reply(`❌ لا يمتلك الكمية الكافية (يمتلك: ${pfItem?.quantity || 0}).`);
            
            if (pfItem.quantity - quantity <= 0) sql.prepare("DELETE FROM user_portfolio WHERE id = ?").run(pfItem.id);
            else sql.prepare("UPDATE user_portfolio SET quantity = quantity - ? WHERE id = ?").run(quantity, pfItem.id);
            
            embed.setDescription(`✅ تم إزالة **${quantity}** × **${item.name}** من محفظة ${targetUser}.`);
        }
        else if (item.type === 'farm') {
            const animals = sql.prepare("SELECT id FROM user_farm WHERE userID = ? AND guildID = ? AND animalID = ? LIMIT ?").all(userID, guildID, item.id, quantity);
            if (animals.length < quantity) return message.reply(`❌ لا يمتلك الكمية الكافية (يمتلك: ${animals.length}).`);
            
            animals.forEach(a => sql.prepare("DELETE FROM user_farm WHERE id = ?").run(a.id));
            embed.setDescription(`✅ تم إزالة **${quantity}** × **${item.name}** من مزرعة ${targetUser}.`);
        }
        else if (item.type === 'shop_special') {
            if (item.id === 'personal_guard_1d') {
                let ud = client.getLevel.get(userID, guildID);
                if (!ud || ud.hasGuard < quantity) return message.reply("❌ لا يمتلك شحنات كافية.");
                ud.hasGuard -= quantity;
                client.setLevel.run(ud);
                embed.setDescription(`✅ تم إزالة **${quantity}** شحنات حماية من ${targetUser}.`);
            }
            else if (item.id === 'streak_shield') {
                sql.prepare("UPDATE streaks SET hasItemShield = 0 WHERE guildID = ? AND userID = ?").run(guildID, userID);
                embed.setDescription(`✅ تم إزالة **درع الستريك** من ${targetUser}.`);
            }
            else if (item.id === 'streak_shield_media') {
                await this.removeMediaShield(message, sql, targetUser, embed);
                return;
            }
        }
        await message.reply({ embeds: [embed] });
    },

    // =========================================================
    // 🏆 دوال الإنجازات والمهام
    // =========================================================
    findAchievement(nameOrID) {
        const input = normalize(nameOrID);
        return questsConfig.achievements.find(a => normalize(a.name) === input || a.id.toLowerCase() === nameOrID.toLowerCase());
    },

    async giveAchievement(message, client, sql, targetUser, targetMember, args, embed) {
        const achName = args.slice(2).join(' ');
        if (!achName) return message.reply("❌ يرجى كتابة اسم الإنجاز.");

        const ach = this.findAchievement(achName);
        if (!ach) return message.reply("❌ الإنجاز غير موجود.");

        const exists = sql.prepare("SELECT 1 FROM user_achievements WHERE userID = ? AND guildID = ? AND achievementID = ?").get(targetUser.id, message.guild.id, ach.id);
        if (exists) return message.reply("ℹ️ لديه الإنجاز بالفعل.");

        sql.prepare("INSERT INTO user_achievements (userID, guildID, achievementID, timestamp) VALUES (?, ?, ?, ?)").run(targetUser.id, message.guild.id, ach.id, Date.now());
        
        // إضافة الجوائز
        let ld = client.getLevel.get(targetUser.id, message.guild.id) || { ...client.defaultData, user: targetUser.id, guild: message.guild.id };
        ld.mora += ach.reward.mora;
        ld.xp += ach.reward.xp;
        client.setLevel.run(ld);

        try { await client.sendQuestAnnouncement(message.guild, targetMember, ach, 'achievement'); } catch (e) {}
        
        embed.setDescription(`✅ تم منح الإنجاز **${ach.name}** لـ ${targetUser}.`);
        await message.reply({ embeds: [embed] });
    },

    async removeAchievement(message, sql, targetUser, args, embed) {
        const achName = args.slice(2).join(' ');
        const ach = this.findAchievement(achName);
        if (!ach) return message.reply("❌ الإنجاز غير موجود.");

        const res = sql.prepare("DELETE FROM user_achievements WHERE userID = ? AND guildID = ? AND achievementID = ?").run(targetUser.id, message.guild.id, ach.id);
        
        if (res.changes) embed.setDescription(`✅ تم إزالة الإنجاز **${ach.name}** من ${targetUser}.`);
        else embed.setColor(Colors.Red).setDescription("ℹ️ لا يمتلك هذا الإنجاز.");
        
        await message.reply({ embeds: [embed] });
    },

    async setStat(message, client, sql, targetUser, targetMember, statName, value, embed) {
        if (!statName || isNaN(parseInt(value))) return message.reply("❌ الاستخدام: `-ادمن ضبط-احصائية @user [اسم الإحصائية] [الرقم]`");
        const val = parseInt(value);
        const guildID = message.guild.id;
        const userID = targetUser.id;

        // محاولة التحديث في عدة جداول
        let updated = false;
        
        // 1. Levels table
        let ld = client.getLevel.get(userID, guildID);
        if (ld && ld.hasOwnProperty(statName)) {
            ld[statName] = val;
            client.setLevel.run(ld);
            updated = true;
        }

        // 2. Total Stats
        let ts = client.getTotalStats.get(`${userID}-${guildID}`);
        if (ts && ts.hasOwnProperty(statName)) {
            ts[statName] = val;
            client.setTotalStats.run(ts);
            updated = true;
        }

        // 3. Streaks
        if (!updated) {
            try {
                sql.prepare(`UPDATE streaks SET ${statName} = ? WHERE guildID = ? AND userID = ?`).run(val, guildID, userID);
                updated = true;
            } catch (e) {}
        }

        if (!updated) return message.reply(`❌ لم يتم العثور على إحصائية باسم \`${statName}\`.`);

        await client.checkAchievements(client, targetMember, ld, ts);
        embed.setDescription(`✅ تم ضبط **${statName}** لـ ${targetUser} إلى **${val}**.`);
        await message.reply({ embeds: [embed] });
    },

    findQuest(nameOrID, questType) {
        const input = normalize(nameOrID);
        const list = questType === 'daily' ? questsConfig.daily : questsConfig.weekly;
        return list.find(q => normalize(q.name) === input || q.id.toLowerCase() === nameOrID.toLowerCase());
    },

    async giveQuest(message, client, sql, targetUser, targetMember, args, questType, embed) {
        const qName = args.slice(2).join(' ');
        const quest = this.findQuest(qName, questType);
        if (!quest) return message.reply("❌ المهمة غير موجودة.");

        const dateKey = questType === 'daily' ? getTodayDateString() : getWeekStartDateString();
        const claimID = `${targetUser.id}-${message.guild.id}-${quest.id}-${dateKey}`;
        
        const exists = sql.prepare("SELECT 1 FROM user_quest_claims WHERE claimID = ?").get(claimID);
        if (exists) return message.reply("ℹ️ أكمل المهمة بالفعل.");

        sql.prepare("INSERT INTO user_quest_claims (claimID, userID, guildID, questID, dateStr) VALUES (?, ?, ?, ?, ?)").run(claimID, targetUser.id, message.guild.id, quest.id, dateKey);
        
        let ld = client.getLevel.get(targetUser.id, message.guild.id) || { ...client.defaultData, user: targetUser.id, guild: message.guild.id };
        ld.mora += quest.reward.mora;
        ld.xp += quest.reward.xp;
        client.setLevel.run(ld);

        try { await client.sendQuestAnnouncement(message.guild, targetMember, quest, questType); } catch (e) {}

        embed.setDescription(`✅ تم إعطاء المهمة **${quest.name}** لـ ${targetUser}.`);
        await message.reply({ embeds: [embed] });
    }
};
