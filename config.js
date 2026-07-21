// Конфигурация каналов и персональных данных сайта.
// youtube — ссылка для людей (@хендл), youtubeId — канал для RSS-ленты.
module.exports = {
  owner: {
    name: 'Алексей Ковалев',
    tagline: 'AI-native CPO, ИИ-инфлюенсер. Основатель сообщества vibec0ding.ru. Рассказываю про ИИ, бизнес, продуктовое управление и инвестиции простым языком.',
    taglineHtml1: 'AI-native CPO, ИИ-инфлюенсер. Основатель сообщества vibec<span class="zero">0</span>ding.ru.',
    taglineHtml2: 'Рассказываю про ИИ, бизнес, продуктовое управление и инвестиции простым языком.',
    github: 'https://github.com/ArrivaRUS',
    email: 'ArrivaRUS@gmail.com',
    community: {
      url: 'https://vibec0ding.ru',
      title: 'vibec0ding.ru',
      titleHtml: 'vibec<span class="zero">0</span>ding.ru', // фирменный красный перечёркнутый ноль
      note: 'сообщество вайб-кодеров для начинающих',
    },
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
      about: 'жизнь · тревел · семья',
      accent: '#5FE982',
      tg: 'akovprolife',
      youtube: 'https://www.youtube.com/@AKov.ProLife',
      youtubeId: 'UCSqHAT42T05grNfRWY77mmw',
    },
  ],
  limits: { tgPosts: 8, ytVideos: 5 },
  refreshMinutes: { tg: 30, yt: 60 },
};
