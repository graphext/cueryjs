import { assertEquals } from '@std/assert';

import { extractDomain } from '../src/urls.ts';

Deno.test('extractDomain returns domain without subdomain by default', () => {
	assertEquals(extractDomain('https://www.example.com'), 'example.com');
	assertEquals(extractDomain('https://subdomain.example.com'), 'example.com');
	assertEquals(extractDomain('example.com'), 'example.com');
	assertEquals(extractDomain('www.example.co.uk'), 'example.co.uk');
});

Deno.test('extractDomain returns FQDN with subdomain when requested', () => {
	assertEquals(extractDomain('https://www.example.com', true), 'example.com');
	assertEquals(extractDomain('https://subdomain.example.com', true), 'subdomain.example.com');
	assertEquals(extractDomain('https://deep.subdomain.example.com', true), 'deep.subdomain.example.com');
});

Deno.test('extractDomain resolves Google Translate URLs', () => {
	const translateUrl = 'https://translate.google.com/translate?u=https://example.com';
	assertEquals(extractDomain(translateUrl), 'example.com');
	assertEquals(extractDomain(translateUrl, true), 'example.com');

	const translateUrlWithSubdomain = 'https://translate.google.com/translate?u=https://blog.example.com';
	assertEquals(extractDomain(translateUrlWithSubdomain), 'example.com');
	assertEquals(extractDomain(translateUrlWithSubdomain, true), 'blog.example.com');
});

Deno.test('extractDomain can skip Google Translate resolution', () => {
	const translateUrl = 'https://translate.google.com/translate?u=https://example.com';
	assertEquals(extractDomain(translateUrl, false, false), 'google.com');
});

Deno.test('extractDomain handles URLs without TLD', () => {
	assertEquals(extractDomain('localhost'), 'localhost');
	assertEquals(extractDomain('http://localhost:3000'), 'http://localhost:3000');
});
