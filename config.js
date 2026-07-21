// Конфигурация каналов и персональных данных сайта.
// YouTube: заполнить channel (URL или @handle) — channelId резолвится автоматически.
module.exports = {
  owner: {
    name: 'Алексей Ковалев',
    tagline: 'Продакт и вайб-кодер. Пишу и снимаю про технологии и AI, инвестиции и жизнь.',
    github: 'https://github.com/ArrivaRUS',
  },
  columns: [
    {
      slug: 'protech',
      title: 'ПроТех',
      about: 'технологии · AI · вайб-кодинг',
      accent: '#0A8BF5',
      tg: 'akovprotech',
      youtube: 'https://www.youtube.com/channel/UCxeM8QqzknBkl5lZ8v5Ta2w',
    },
    {
      slug: 'proinvest',
      title: 'ПроИнвест',
      about: 'инвестиции · TradFi + DeFi',
      accent: '#F47F19',
      tg: 'AKovProInvest',
      youtube: null,
    },
    {
      slug: 'prolife',
      title: 'ПроLife',
      about: 'жизнь · спорт · семья',
      accent: '#5FE982',
      tg: 'akovprolife',
      youtube: 'https://www.youtube.com/channel/UCSqHAT42T05grNfRWY77mmw',
    },
  ],
  limits: { tgPosts: 8, ytVideos: 5 },
  refreshMinutes: { tg: 30, yt: 60 },
};
