import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';

type LibraryItem = {
  id: number;
  title: string;
  link: string;
  cover?: string;
  status?: {
    key: string;
    label: string;
    class: string;
  };
  chapters_count?: number;
};

type LibraryResponse = {
  page: number;
  per_page: number;
  total: number;
  totalPages: number;
  items?: LibraryItem[];
};

type ChapterItemApi = {
  label: string;
  url: string;
  num?: string;
  date?: string;
  time?: string;
  views?: number;
};

type MangaChaptersResponse = {
  manga_id: number;
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
  items?: ChapterItemApi[];
};

type SearchItem = {
  id: number;
  title: string;
  link: string;
  cover?: string;
  genres?: string[];
  chapters_count?: number;
};

type SearchResponse = {
  term: string;
  items?: SearchItem[];
};

class MarkazRiwayat implements Plugin.PluginBase {
  id = 'markazriwayat';
  name = 'مركز الروايات (Markaz Riwayat)';
  icon = 'src/ar/markazriwayat/icon.png';
  site = 'https://markazriwayat.com/';
  version = '1.0.0';

  async popularNovels(
    page: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (showLatestNovels) {
      // Scrape latest updates from the home page "أحدث الفصول" section
      if (page > 1) {
        return [];
      }

      const response = await fetchApi(this.site);
      const body = await response.text();
      const loadedCheerio = parseHTML(body);

      const novels: Plugin.NovelItem[] = [];
      loadedCheerio('.latest-list article.latest-card').each((i, el) => {
        const name = loadedCheerio(el).find('.latest-title').text().trim();
        const link = loadedCheerio(el).find('.latest-title').attr('href') || '';
        const cover = loadedCheerio(el).find('.latest-cover img').attr('data-src') || 
                      loadedCheerio(el).find('.latest-cover img').attr('src') || 
                      defaultCover;
        novels.push({
          name,
          cover,
          path: link.replace(/https?:\/\/markazriwayat\.com\//, ''),
        });
      });
      return novels;
    }

    const hasActiveFilters = filters && (
      (filters.sort && filters.sort.value !== 'views') ||
      (filters.status && filters.status.value !== '') ||
      (filters.genres && filters.genres.value && filters.genres.value.length > 0) ||
      (filters.tags && filters.tags.value && filters.tags.value.length > 0)
    );

    if (hasActiveFilters) {
      // Use REST API for filtered requests
      let link = `${this.site}wp-json/theam/v1/library?page=${page}&per_page=20`;
      if (filters) {
        if (filters.sort && filters.sort.value !== '') {
          link += `&sort=${filters.sort.value}`;
        }
        if (filters.status && filters.status.value !== '') {
          link += `&status=${filters.status.value}`;
        }
        if (filters.genres && filters.genres.value && filters.genres.value.length > 0) {
          link += `&genres=${filters.genres.value.map(g => encodeURIComponent(g)).join(',')}`;
        }
        if (filters.tags && filters.tags.value && filters.tags.value.length > 0) {
          link += `&tags=${filters.tags.value.map(t => encodeURIComponent(t)).join(',')}`;
        }
      }

      const response = await fetchApi(link);
      const data = (await response.json()) as LibraryResponse;

      const novels: Plugin.NovelItem[] = [];
      if (data && data.items) {
        data.items.forEach((item: LibraryItem) => {
          novels.push({
            name: item.title,
            cover: item.cover || defaultCover,
            path: item.link.replace(/https?:\/\/markazriwayat\.com\//, ''),
          });
        });
      }
      return novels;
    } else {
      // Scrape popular page: https://markazriwayat.com/popular/?range=all
      const link = page > 1 
        ? `${this.site}popular/page/${page}/?range=all` 
        : `${this.site}popular/?range=all`;

      const response = await fetchApi(link);
      const body = await response.text();
      const loadedCheerio = parseHTML(body);

      const novels: Plugin.NovelItem[] = [];
      loadedCheerio('.library-grid a.lib-card').each((i, el) => {
        const name = loadedCheerio(el).find('.lib-card__title').text().trim();
        const href = loadedCheerio(el).attr('href') || '';
        const cover = loadedCheerio(el).find('img').attr('data-src') || 
                      loadedCheerio(el).find('img').attr('src') || 
                      defaultCover;
        novels.push({
          name,
          cover,
          path: href.replace(/https?:\/\/markazriwayat\.com\//, ''),
        });
      });
      return novels;
    }
  }

  async parseNovel(novelUrl: string): Promise<Plugin.SourceNovel> {
    const fullUrl = new URL(novelUrl, this.site).toString();
    const result = await fetchApi(fullUrl);
    const body = await result.text();
    const loadedCheerio = parseHTML(body);

    const mangaId = loadedCheerio('#manga-chapters-list').attr('data-manga-id');
    if (!mangaId) {
      throw new Error('Manga ID not found');
    }

    const name = loadedCheerio('h1.manga-title').text().trim() || 'Untitled';
    const cover = loadedCheerio('.manga-cover-wrap > img').attr('data-src') || 
                  loadedCheerio('.manga-cover-wrap > img').attr('src') || 
                  defaultCover;
    const author = loadedCheerio('.manga-author__link').text().trim() || 'Unknown';
    const summary = loadedCheerio('#manga-summary').text().trim() || '';

    const statusText = loadedCheerio('.manga-status-pill').text().trim();
    const status = {
      'مستمرة': 'Ongoing',
      'مكتملة': 'Completed',
      'متوقفة': 'On Hiatus',
    }[statusText] || 'Unknown';

    // Fetch chapters list starting with page 1
    const chaptersLink = `${this.site}wp-json/theam/v1/manga-chapters?manga_id=${mangaId}&page=1&per_page=100`;
    const firstPageResponse = await fetchApi(chaptersLink);
    const firstPageData = (await firstPageResponse.json()) as MangaChaptersResponse;

    const totalChapters = firstPageData.total || 0;
    const perPage = 100;
    const totalPages = Math.ceil(totalChapters / perPage);

    const promises: Promise<MangaChaptersResponse>[] = [];
    const pagesResults = [firstPageData];
    for (let i = 2; i <= totalPages; i++) {
      promises.push(
        fetchApi(`${this.site}wp-json/theam/v1/manga-chapters?manga_id=${mangaId}&page=${i}&per_page=${perPage}`)
          .then(r => r.json() as Promise<MangaChaptersResponse>)
      );
    }
    if (promises.length > 0) {
      const restResults = await Promise.all(promises);
      pagesResults.push(...restResults);
    }

    const chapterItems: Plugin.ChapterItem[] = [];
    pagesResults.forEach(pageData => {
      if (pageData && pageData.items) {
        pageData.items.forEach((item: ChapterItemApi) => {
          chapterItems.push({
            name: item.label,
            releaseTime: item.date ? new Date(item.date).toISOString() : undefined,
            path: item.url.replace(/https?:\/\/markazriwayat\.com\//, ''),
            chapterNumber: item.num ? Number(item.num) : undefined,
          });
        });
      }
    });

    // Reversing ensures the chapter list starts from Chapter 1
    chapterItems.reverse();

    const novel: Plugin.SourceNovel = {
      path: novelUrl,
      name,
      cover,
      author,
      summary,
      status,
      chapters: chapterItems,
    };

    return novel;
  }

  async parseChapter(chapterUrl: string): Promise<string> {
    const fullUrl = new URL(chapterUrl, this.site).toString();
    const result = await fetchApi(fullUrl);
    const body = await result.text();
    const loadedCheerio = parseHTML(body);

    // Remove obfuscation/watermark elements
    loadedCheerio('.theam-chobf').remove();
    loadedCheerio('[style*="display:none"]').remove();
    loadedCheerio('[style*="display: none"]').remove();
    loadedCheerio('[style*="visibility:hidden"]').remove();
    loadedCheerio('[style*="visibility: hidden"]').remove();
    loadedCheerio('[style*="opacity:0"]').remove();
    loadedCheerio('[style*="opacity: 0"]').remove();

    // Remove non-content elements
    loadedCheerio('input').remove();
    loadedCheerio('script').remove();
    loadedCheerio('style').remove();

    const chapterHtml = loadedCheerio('.reading-content').html() || '';
    return chapterHtml.trim();
  }

  async searchNovels(
    searchTerm: string,
    page: number,
  ): Promise<Plugin.NovelItem[]> {
    if (page > 1) {
      return [];
    }

    const link = `${this.site}wp-json/theam/v1/novel-search?term=${encodeURIComponent(searchTerm)}`;
    const response = await fetchApi(link);
    const data = (await response.json()) as SearchResponse;

    const novels: Plugin.NovelItem[] = [];
    if (data && data.items) {
      data.items.forEach((item: SearchItem) => {
        novels.push({
          name: item.title,
          cover: item.cover || defaultCover,
          path: item.link.replace(/https?:\/\/markazriwayat\.com\//, ''),
        });
      });
    }
    return novels;
  }

  filters = {
    sort: {
      value: 'views',
      label: 'الترتيب حسب',
      options: [
        { label: 'الأكثر مشاهدة', value: 'views' },
        { label: 'آخر التحديثات', value: 'latest' },
        { label: 'شائع', value: 'popular' },
        { label: 'التقييم', value: 'rating' },
        { label: 'الأحدث', value: 'newest' },
        { label: 'أبجدي', value: 'alphabet' },
        { label: 'الرتبة', value: 'rank' },
      ],
      type: FilterTypes.Picker,
    },
    status: {
      value: '',
      label: 'حالة الرواية',
      options: [
        { label: 'الكل', value: '' },
        { label: 'مستمر', value: 'on-going' },
        { label: 'مكتملة', value: 'end' },
        { label: 'متوقفة', value: 'canceled' },
      ],
      type: FilterTypes.Picker,
    },
    genres: {
      value: [],
      label: 'التصنيفات',
      options: [
        { label: 'drama', value: 'drama' },
        { label: 'أكشن', value: 'أكشن' },
        { label: 'البطل انثى', value: 'البطل-انثى' },
        { label: 'البطل ذكر', value: 'البطل-ذكر' },
        { label: 'الحياة الحضرية', value: 'الحياة-الحضرية' },
        { label: 'الحياة المدرسية', value: 'الحياة-المدرسية' },
        { label: 'الزراعة', value: 'الزراعة' },
        { label: 'الهجرة', value: 'الهجرة' },
        { label: 'بناء القواعد', value: 'بناء-القواعد' },
        { label: 'تاريخي', value: 'تاريخي' },
        { label: 'تشويق', value: 'تشويق' },
        { label: 'حرب النجوم', value: 'حرب-النجوم' },
        { label: 'حريم', value: 'حريم' },
        { label: 'حسّم في القتل', value: 'حسم-في-القتل' },
        { label: 'خيال', value: 'خيال' },
        { label: 'خيال علمي', value: 'خيال-علمي' },
        { label: 'دراما', value: 'دراما' },
        { label: 'رعب', value: 'رعب' },
        { label: 'رعب بالغ', value: 'رعب-بالغ' },
        { label: 'سحر', value: 'سحر' },
        { label: 'شريحة من الحياة', value: 'شريحة-من-الحياة' },
        { label: 'شونين', value: 'شونين' },
        { label: 'عسكري', value: 'عسكري' },
        { label: 'غموض', value: 'غموض' },
        { label: 'فانتازيا', value: 'فانتازيا' },
        { label: 'فنون قتالية', value: 'فنون-قتالية' },
        { label: 'قتال', value: 'قتال' },
        { label: 'قوى خارقة', value: 'قوى-خارقة' },
        { label: 'كوارث', value: 'كوارث' },
        { label: 'كوميديا', value: 'كوميديا' },
        { label: 'لعبة', value: 'لعبة' },
        { label: 'مأساة', value: 'مأساة' },
        { label: 'محاكاة', value: 'محاكاة' },
        { label: 'محاكي', value: 'محاكي' },
        { label: 'مصاصو الدماء', value: 'مصاصو-الدماء' },
        { label: 'مغامرة', value: 'مغامرة' },
        { label: 'ميكا', value: 'ميكا' },
        { label: 'مهارات القتال', value: 'مهارات-القتال' },
        { label: 'نظام', value: 'نظام' },
        { label: 'نفسي', value: 'نفسي' },
      ],
      type: FilterTypes.CheckboxGroup,
    },
    tags: {
      value: [],
      label: 'المنشأ',
      options: [
        { label: 'رواية انجليزية', value: 'رواية-انجليزية' },
        { label: 'رواية صينية', value: 'رواية-صينية' },
        { label: 'رواية عربية', value: 'رواية-عربية' },
        { label: 'رواية كورية', value: 'رواية-كورية' },
        { label: 'رواية يابانية', value: 'رواية-يابانية' },
      ],
      type: FilterTypes.CheckboxGroup,
    },
  } satisfies Filters;
}

export default new MarkazRiwayat();
