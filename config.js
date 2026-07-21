// Конфигурация каналов и персональных данных сайта.
// youtube — ссылка для людей (@хендл), youtubeId — канал для RSS-ленты.
module.exports = {
  owner: {
    name: 'Алексей Ковалев',
    tagline: 'ИИ-инфлюенсер, AI-native CPO. Основатель сообщества вайб-кодеров для начинающих vibec0ding.ru. Рассказываю про частный капитал и личные инвестиции простым языком — для тех, кто только начинает разбираться в финансах.',
    taglineHtml: 'ИИ-инфлюенсер, AI-native CPO. Основатель <a href="https://vibec0ding.ru" target="_blank" rel="noopener">сообщества вайб-кодеров для начинающих vibec0ding.ru</a>.<br>Рассказываю про частный капитал и личные инвестиции простым языком — для тех, кто только начинает разбираться в финансах.',
    github: 'https://github.com/ArrivaRUS',
    community: { url: 'https://vibec0ding.ru', title: 'vibec0ding.ru', note: 'сообщество вайб-кодеров для начинающих' },
  },
  columns: [
    {
      slug: 'protech',
      title: 'ПроТех',
      about: 'технологии · AI · вайб-кодинг',
      accent: '#0A8BF5',
      tg: 'akovprotech',
      youtube: 'https://www.youtube.com/@AKov.ProTech',
      youtubeId: 'UCxeM8QqzknBkl5lZ8v5Ta2w',
    },
    {
      slug: 'proinvest',
      title: 'ПроИнвест',
      about: 'частный капитал · инвестиции простым языком',
      accent: '#F47F19',
      tg: 'AKovProInvest',
      youtube: 'https://www.youtube.com/@AKov.ProInvest',
      youtubeId: 'UCOxSJwbV9hqgZsee4oQ8Vqg',
    },
    {
      slug: 'prolife',
      title: 'ПроLife',
      about: 'жизнь · спорт · семья',
      accent: '#5FE982',
      tg: 'akovprolife',
      youtube: 'https://www.youtube.com/@AKov.ProLife',
      youtubeId: 'UCSqHAT42T05grNfRWY77mmw',
    },
  ],
  limits: { tgPosts: 8, ytVideos: 5 },
  refreshMinutes: { tg: 30, yt: 60 },
};
