import * as cheerio from 'cheerio';

function extractIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    // Handle both full URLs and relative paths
    const path = href.includes('flixhq')
      ? new URL(href).pathname
      : href;
    // Remove leading/trailing slashes, then replace only the FIRST slash with hyphen
    // This preserves the format: watch-series-slug-name so provider can reconstruct as watch-series/slug-name
    const cleaned = path
      .replace(/^\/+/, '')
      .replace(/\/+$/g, '');
    // Replace only the first slash with hyphen
    return cleaned.replace('/', '-') || null;
  } catch {
    // Fallback for malformed URLs
    const cleaned = href
      .replace(/^\/+/, '')
      .replace(/\/+$/g, '');
    return cleaned.replace('/', '-') || null;
  }
}

export function parseItems($: cheerio.CheerioAPI, selector: string) {
  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find('span.float-right.fdi-type').text().trim();
    const baseData = {
      id: extractIdFromHref(
        $(element)
          .find('a.film-poster-ahref.flw-item-tip')
          .attr('href')
      ),
      name: $(element).find('h3.film-name').text().trim() || null,
      posterImage: $(element).find('img.film-poster-img.lazyload').attr('data-src') || null,
      quality: $(element).find('div.pick.film-poster-quality').text().trim() || null,
      type,
    };
    if (type === 'Movie') {
      items.push({
        ...baseData,
        releaseDate: Number($(element).find('div.fd-infor > span.fdi-item:first').text().trim()) || null,
        duration: $(element).find('div.fd-infor > span.fdi-duration').text().trim() || null,
      });
    } else if (type === 'TV') {
      const seasonText = $(element).find('div.fd-infor > span.fdi-item:first').text().trim();
      const episodesText = $(element).find('div.fd-infor > span.fdi-item').eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith('SS')) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ''), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith('EPS')) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ''), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({ ...baseData, seasons, totalEpisodes });
    }
  });
  return items;
}

export function parseMixedSection($: cheerio.CheerioAPI, selector: string) {
  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find('span.float-right.fdi-type').text().trim();
    const baseData = {
      id: extractIdFromHref(
        $(element)
          .find('a.film-poster-ahref.flw-item-tip')
          .attr('href')
      ),
      name: $(element).find('h3.film-name').text().trim() || null,
      posterImage: $(element).find('img.film-poster-img.lazyload').attr('data-src') || null,
      quality: $(element).find('div.pick.film-poster-quality').text().trim() || null,
      type,
    };
    if (type === 'Movie') {
      items.push({
        ...baseData,
        releaseDate: Number($(element).find('div.fd-infor > span.fdi-item:first').text().trim()) || null,
        duration: $(element).find('div.fd-infor > span.fdi-duration').text().trim() || null,
      });
    } else if (type === 'TV') {
      const releaseDate = $(element).find('div.fd-infor > span.fdi-item:first').text().trim() || null;
      const seasonText = $(element).find('div.fd-infor > span.fdi-item').eq(1).text().trim();
      const episodesText = $(element).find('div.fd-infor > span.fdi-item').eq(2).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith('SS')) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ''), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith('EPS')) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ''), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({ ...baseData, releaseDate, seasons, totalEpisodes });
    }
  });
  return items;
}

export function parseHome($: cheerio.CheerioAPI) {
  const slider: any[] = [];
  $('div#slider > div.swiper-wrapper > div.swiper-slide').each((_, element) => {
    const id = extractIdFromHref(
      $(element)
        .find('a.slide-link')
        .attr('href')
    );
    const type = id?.includes('tv') || id?.includes('series') ? 'TV' : 'Movie';
    slider.push({
      id: id || null,
      name: $(element).find('h3.film-title').text().trim() || null,
      posterImage: $(element).attr('style')?.match(/url\(["']?(.*?)["']?\)/)?.[1] || null,
      type: type || null,
      quality: $(element).find('div.scd-item > span.quality').text().trim() || null,
      duration: $(element).find('div.scd-item strong').eq(0).text().trim() || null,
      score: Number($(element).find('div.scd-item strong').eq(1).text().trim()) || null,
      genre:
        $(element)
          .find('div.scd-item strong')
          .eq(2)
          .map((i, el) => $(el).text().replace(/\s+/g, ' ').trim())
          .get() || null,
      synopsis: $(element).find('p.sc-desc').text().trim() || null,
    });
  });

  return {
    featured: slider,
    trending: {
      Movies: parseItems($, 'div#trending-movies div.film_list-wrap > div.flw-item'),
      Tv: parseItems($, 'div#trending-tv div.film_list-wrap > div.flw-item'),
    },
    recentReleases: {
      Movies: parseItems(
        $,
        'section.block_area.block_area_home.section-id-02:first div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item',
      ),
      Tv: parseItems(
        $,
        'section.block_area.block_area_home.section-id-02:eq(1) div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item',
      ),
    },
    upcoming: parseMixedSection(
      $,
      'section.block_area.block_area_home.section-id-02:eq(2) div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item',
    ),
  };
}

export function parsePaginatedResults($: cheerio.CheerioAPI, selector: string) {
  const paginationElement = $('div.pre-pagination:last ul.pagination-lg.justify-content-center');
  const hasNextPage =
    ($('.pagination > li').length > 0 &&
      $('.pagination li.active').length > 0 &&
      !$('.pagination > li').last().hasClass('active')) ||
    false;
  const currentPage = Number(
    $(paginationElement).find('li[class="page-item active"]').text().trim() || 1,
  );
  const lastPage = Number(
    paginationElement
      .find('a.page-link[title="Last"]')
      .attr('href')
      ?.split('page=')
      .at(-1) ||
      paginationElement.find('a.page-link:last').text().trim() ||
      currentPage,
  );
  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find('span.float-right.fdi-type').text().trim();
    const baseData = {
      id: extractIdFromHref(
        $(element)
          .find('a.film-poster-ahref.flw-item-tip')
          .attr('href')
      ),
      name:
        $(element).find('h2.film-name, h3.film-name').first().text().replace(/\s+/g, ' ').trim() ||
        $(element).find('img.film-poster-img').attr('alt')?.replace(/\s+Watch Online.*$/i, '').trim() ||
        null,
      posterImage:
        $(element).find('img.film-poster-img.lazyload').attr('data-src') ||
        $(element).find('img.film-poster-img').attr('src') ||
        null,
      quality: $(element).find('div.pick.film-poster-quality').text().trim() || null,
      type,
    };
    if (type === 'Movie') {
      items.push({
        ...baseData,
        releaseDate: Number($(element).find('div.fd-infor > span.fdi-item:first').text().trim()) || null,
        duration: $(element).find('div.fd-infor > span.fdi-duration').text().trim() || null,
      });
    } else if (type === 'TV') {
      const seasonText = $(element).find('div.fd-infor > span.fdi-item:first').text().trim() || null;
      const episodesText = $(element).find('div.fd-infor > span.fdi-item').eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith('SS')) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ''), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith('EPS')) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ''), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({ ...baseData, seasons, totalEpisodes });
    }
  });
  return { hasNextPage, currentPage, lastPage, data: items };
}

export function parseSearchSuggestions($: cheerio.CheerioAPI) {
  const items: any[] = [];
  $('a.nav-item').each((_, element) => {
    const type = $(element).find('div.film-infor span:last').text().trim();
    const baseData = {
      id: extractIdFromHref($(element).attr('href')),
      name: $(element).find('h3.film-name').text().trim() || null,
      posterImage: $(element).find('img.film-poster-img').attr('src') || null,
      type,
    };
    if (type === 'Movie') {
      items.push({
        ...baseData,
        releaseDate: Number($(element).find('div.film-infor > span:first').text().trim()) || null,
        duration: $(element).find('div.film-infor > span').eq(1).text().trim() || null,
      });
    } else if (type === 'TV') {
      const seasonText = $(element).find('div.film-infor > span:first').text().trim() || null;
      const episodesText = $(element).find('div.film-infor > span').eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith('SS')) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ''), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith('EPS')) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ''), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({ ...baseData, seasons, totalEpisodes });
    }
  });
  return { data: items };
}

export function parseInfo($: cheerio.CheerioAPI) {
  const recommended: any[] = [];
  $('div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item').each((_, element) => {
    const type = $(element).find('span.float-right.fdi-type').text().trim();
    const baseData = {
      id: extractIdFromHref(
        $(element)
          .find('a.film-poster-ahref.flw-item-tip')
          .attr('href')
      ),
      name: $(element).find('h3.film-name').text().trim() || null,
      posterImage: $(element).find('img.film-poster-img.lazyload').attr('data-src') || null,
      quality: $(element).find('div.pick.film-poster-quality').text().trim() || null,
      type,
    };
    if (type === 'Movie') {
      recommended.push({
        ...baseData,
        releaseDate: $(element).find('div.fd-infor > span.fdi-item:first').text().trim() || null,
        duration: $(element).find('div.fd-infor > span.fdi-duration').text().trim() || null,
      });
    } else if (type === 'TV') {
      const seasonText = $(element).find('div.fd-infor > span.fdi-item:first').text().trim() || null;
      const episodesText = $(element).find('div.fd-infor > span.fdi-item').eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith('SS')) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ''), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith('EPS')) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ''), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      recommended.push({ ...baseData, seasons, totalEpisodes });
    }
  });

  const headingLink = $('.m_i-d-content .heading-name > a, h1.heading-name > a, h2.heading-name > a').first();
  const pageHref =
    headingLink.attr('href') ||
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content');
  const id = extractIdFromHref(pageHref) || null;
  const type = id?.includes('tv') || id?.includes('series') ? 'TV' : 'Movie';
  const structuredTitle = $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        const json = JSON.parse($(el).contents().text());
        const graphItems = Array.isArray(json?.['@graph']) ? json['@graph'] : [json];
        const mediaItem = graphItems.find((item: any) =>
          ['Movie', 'TVSeries', 'Series'].includes(String(item?.['@type'] || '')),
        );
        return typeof mediaItem?.name === 'string' ? mediaItem.name.trim() : null;
      } catch {
        return null;
      }
    })
    .get()
    .find(Boolean);

  const mediaInfo = {
    id,
    name:
      headingLink.text().replace(/\s+/g, ' ').trim() ||
      structuredTitle ||
      $('meta[property="og:title"]').attr('content')?.replace(/^Watch\s+/i, '').replace(/\s+FlixHQ.*$/i, '').trim() ||
      $('img#image_storage').attr('alt')?.trim() ||
      null,
    posterImage:
      $('img#image_storage').attr('data-img') ||
      $('img#image_storage').attr('src') ||
      $('div.w_b-cover').attr('style')?.match(/url\(["']?(.*?)["']?\)/)?.[1] ||
      null,
    type,
    quality: $('div.stats button.btn.btn-sm.btn-quality').text().trim() || null,
    releaseDate: $('.row-line:has(span:contains("Released:"))').text().replace('Released:', '').trim() || null,
    genre:
      $('.row-line:has(span:contains("Genre:")) a')
        .map((i, el) => $(el).text().split('&'))
        .get()
        .map((v) => v.trim()) || null,
    casts:
      $('.row-line:has(span:contains("Casts:")) a')
        .map((i, el) => $(el).text().trim())
        .get() || null,
    duration: $('div.stats span.item.mr-3').eq(2).text().trim() || null,
    score: Number($('div.stats span.item.mr-3').eq(1).text().trim()) || null,
    country:
      $('.row-line:has(span:contains("Country:")) a')
        .map((i, el) => $(el).text().trim())
        .get() || null,
    production:
      $('.row-line:has(span:contains("Production:"))')
        .text()
        .replace('Production:', '')
        .replace(/\s+/g, ' ')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean) || null,
    trailer: $('iframe#iframe-trailer').attr('data-src') || null,
    synopsis: $('.description').text().trim() || null,
  };

  return { data: mediaInfo, recommended };
}

export function parseSeasons($: cheerio.CheerioAPI) {
  const legacy = $(`.dropdown-menu > a`)
    .map((_, el) => {
      const seasonId = $(el).attr('data-id');
      const label = $(el).text().trim();
      const seasonNumber = parseInt(label.replace(/\D/g, ''), 10) || 1;
      return { seasonId, seasonNumber };
    })
    .get();

  if (legacy.length) return legacy;

  return $(`.ss-item`)
    .map((_, el) => {
      const seasonId = $(el).attr('data-id') || $(el).find('a').attr('data-id');
      const label = $(el).text().trim();
      const seasonNumber = parseInt(label.replace(/\D/g, ''), 10) || 1;
      return { seasonId, seasonNumber };
    })
    .get();
}

export function parseEpisodes($: cheerio.CheerioAPI, seasonNumber: number, mediaId: string) {
  const legacy = $(`.nav > li`)
    .map((_, el) => {
      const anchor = $(el).find('a');
      const rawId = anchor.attr('id');
      const title = anchor.attr('title');
      const extractedId = rawId?.split('-')[1];
      if (!extractedId) return null;
      const episodeTitle = title?.split(':').at(1)?.trim() || null;
      return {
        episodeId: `${mediaId.replace('watch-', '')}-episode-${extractedId}`,
        title: episodeTitle,
        episodeNumber: parseInt(title?.split(':')[0].slice(3).trim() || '0', 10) || null,
        seasonNumber: seasonNumber || null,
      };
    })
    .get()
    .filter(Boolean);

  if (legacy.length) return legacy;

  return $(`.eps-item`)
    .map((_, el) => {
      const anchor = $(el).is('a') ? $(el) : $(el).find('a');
      const rawId =
        anchor.attr('data-id') ||
        $(el).attr('data-id') ||
        anchor.attr('id')?.split('-')[1] ||
        extractIdFromHref(anchor.attr('href'));
      if (!rawId) return null;

      const rawNumber =
        anchor.attr('data-number') ||
        $(el).attr('data-number') ||
        anchor.attr('href')?.match(/s(\d+)-e(\d+)/i)?.[2] ||
        anchor.text() ||
        anchor.attr('title') ||
        '';
      const episodeNumber = parseInt(String(rawNumber).replace(/\D/g, ''), 10) || null;
      const seasonFromHref = anchor.attr('href')?.match(/s(\d+)-e\d+/i)?.[1];
      const resolvedSeasonNumber = parseInt(String(seasonFromHref || seasonNumber || ''), 10) || seasonNumber || null;
      const titleAttr = anchor.attr('title') || anchor.text().trim();
      const episodeTitle = titleAttr?.split(':').at(1)?.trim() || titleAttr || null;

      return {
        episodeId: String(rawId).startsWith('episode-')
          ? rawId
          : `${mediaId.replace('watch-', '')}-episode-${rawId}`,
        title: episodeTitle,
        episodeNumber,
        seasonNumber: resolvedSeasonNumber,
      };
    })
    .get()
    .filter(Boolean);
}

export function parseServers($: cheerio.CheerioAPI) {
  const servers: any[] = [];
  $('ul.nav > li.nav-item').each((_, element) => {
    const serverId = $(element).find('a').attr('data-id') || $(element).find('a').attr('data-linkid');
    servers.push({
      serverId: serverId || null,
      serverName: $(element).find('a').text().trim().toLowerCase() || null,
    });
  });
  return servers;
}
