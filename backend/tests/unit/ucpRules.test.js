'use strict';

const { UCP_RULES, getArticleForField, getRelatedArticles } = require('../../src/utils/ucpRules');

describe('ucpRules', () => {
  describe('UCP_RULES object', () => {
    test('contains entries for all critical articles', () => {
      // Art. 14 is keyed as sub-articles (14(a)…14(j)); other articles use plain numbers
      const criticalArticles = ['14(a)', '18', '20', '28', '6', '7'];
      for (const art of criticalArticles) {
        expect(UCP_RULES).toHaveProperty(art);
        expect(UCP_RULES[art]).toHaveProperty('title');
        expect(UCP_RULES[art]).toHaveProperty('description');
      }
    });

    test('Art. 14 covers cross-document consistency (the legal basis of this product)', () => {
      const art14 = UCP_RULES['14'] || UCP_RULES['14(d)'] || Object.values(UCP_RULES).find(a => a.articleNumber && a.articleNumber.startsWith('14'));
      expect(art14).toBeDefined();
    });
  });

  describe('getArticleForField()', () => {
    test('returns a UCP article string for lc.beneficiary', () => {
      const article = getArticleForField('lc', 'beneficiary');
      expect(typeof article).toBe('string');
      expect(article.length).toBeGreaterThan(0);
    });

    test('returns a UCP article for invoice.totalValue', () => {
      const article = getArticleForField('invoice', 'totalValue');
      expect(typeof article).toBe('string');
    });

    test('returns a UCP article for bl.portOfLoading', () => {
      const article = getArticleForField('bl', 'portOfLoading');
      expect(typeof article).toBe('string');
    });

    test('returns null (or a string) for unknown field — never throws', () => {
      // getArticleForField returns null when a field has no mapping; that is acceptable
      const article = getArticleForField('lc', 'nonExistentField');
      // must not throw; result is either null or a string
      expect(article === null || typeof article === 'string').toBe(true);
    });

    test('returns null (or a string) for unknown document type — never throws', () => {
      const article = getArticleForField('unknownDoc', 'someField');
      expect(article === null || typeof article === 'string').toBe(true);
    });
  });

  describe('getRelatedArticles()', () => {
    test('returns an array for article 14', () => {
      const related = getRelatedArticles('14');
      expect(Array.isArray(related)).toBe(true);
    });

    test('returns an array (possibly empty) for unknown article', () => {
      const related = getRelatedArticles('999');
      expect(Array.isArray(related)).toBe(true);
    });
  });
});
