// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://decisionnerd.github.io',
	base: '/t3-coordinator',
	integrations: [
		starlight({
			title: 't3-coordinator',
			description:
				'Durable engineering coordination around stock T3 Code — assign, wait, review, recover.',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/DecisionNerd/t3-coordinator',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/DecisionNerd/t3-coordinator/edit/main/website/',
			},
			sidebar: [
				{
					label: 'Start',
					items: [
						{ label: 'Quick start', slug: 'guides/quick-start' },
						{ label: 'Where work happens', slug: 'guides/where-work-happens' },
						{ label: 'Customize your workflow', slug: 'guides/customize-workflow' },
					],
				},
				{
					label: 'Journeys',
					items: [{ label: 'DX paths', slug: 'guides/dx-paths' }],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Commands', slug: 'reference/commands' },
						{ label: 'In-repo docs', slug: 'reference/in-repo-docs' },
					],
				},
			],
		}),
	],
});
