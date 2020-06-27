#!/usr/bin/env node

import { get } from 'https';
import semver from 'semver';
import aim from '@xutl/aim';
import { strings } from '@xutl/istream';
import JSON from '@xutl/json';
import { resolve } from 'path';
import { statSync } from 'fs';

if ((module.id = '.')) {
	const MODES = ['patch', 'minor', 'major'];
	if (process.argv.length < 3 || process.argv.length > 4) bail(1);
	const base = resolve(process.argv[2]);
	const mode = (process.argv[3] || undefined) as Mode | undefined;

	if (mode && !MODES.includes(mode)) bail(2);
	if (!statSync(base).isDirectory()) bail(3);
	if (!statSync(`${base}/package.json`).isFile()) bail(4);

	main(base, mode).catch((e) => {
		console.error(e);
		bail(5);
	});

	async function main(pkgdir: string, mode?: Mode) {
		const { execSync } = require('child_process');
		const pre = process.cwd();
		try {
			process.chdir(pkgdir);
			const registry = execSync('npm config get registry').toString('utf-8').trim();
			const commits = execSync('git log --pretty=format:"%H"')
				.toString('utf-8')
				.split(/\r?\n/)
				.map((s: string) => s.trim())
				.filter((s: string) => !!s);

			const packageJSON = (await JSON.read(`./package.json`)) as Package;
			const original = packageJSON.version;
			const version = (packageJSON.version = await getVersion(packageJSON.name, registry));

			console.error(`@latest = ${version}`);
			let res = -1;
			try {
				const relh = execSync(`git rev-list -n 1 v${version}`).toString('utf-8').trim();
				res = commits.indexOf(relh);
			} catch (ex) {}
			const chg = res < 0 ? Number.POSITIVE_INFINITY : res;

			mode = mode ?? chg ? 'patch' : undefined;
			if (bump(packageJSON, chg ? mode : undefined)) {
				console.log(`${packageJSON.name} set to ${packageJSON.version} (${!chg ? 'published' : 'to publish'})`);
			} else {
				console.log(`${packageJSON.name} is at ${packageJSON.version} (${!chg ? 'published' : 'to publish'})`);
			}
			if (original !== packageJSON.version)
				await JSON.write(`${pkgdir}/package.json`, packageJSON, { whitespace: '\t' });
		} finally {
			process.chdir(pre);
		}
	}
	function bail(code: number = 1) {
		console.error(`xutlversion <path/to/package/> [ ${MODES.join(' | ')} ]`);
		process.exit(code);
	}
}

export type Mode = 'patch' | 'minor' | 'major';
export interface Package {
	name: string;
	version: string;
	[name: string]: any;
}

export async function bump(packageJSON: Package, mode?: Mode) {
	const version = packageJSON.version;
	const next = mode ? semver.inc(version, mode) : version;
	if (!next) throw new Error(`failed to increment ${version}`);
	packageJSON.version = next;
	return version !== next;
}

export function getVersion(packageName: string, registry: string = 'https://registry.npmjs.org/'): Promise<string> {
	return new Promise((resolve, reject) => {
		get(`${registry}/${encodeURIComponent(packageName)}`, async (res) => {
			try {
				if (res.statusCode === 404) return resolve('0.0.0');
				if (res.statusCode !== 200) throw new Error(`http status: ${res.statusCode}`);
				const result = JSON.parse((await aim(strings(res)).array()).join(''))['dist-tags'].latest;
				if (!result) throw new Error('no version found');
				const cleaned = semver.clean(result);
				if (!cleaned) throw new Error('invalid version found');
				resolve(cleaned);
			} catch (err) {
				reject(err);
			}
		}).on('error', reject);
	});
}
