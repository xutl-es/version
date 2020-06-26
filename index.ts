#!/usr/bin/env node

import { get } from 'https';
import semver from 'semver';
import aim from '@xutl/aim';
import { strings } from '@xutl/istream';
import JSON from '@xutl/json';

if ((module.id = '.')) {
	if (process.argv.length < 3 || process.argv.length > 4) {
		console.error('xutlversion <path/to/package.json> [ none | patch | minor | major ]');
		process.exit(1);
	}
	const registry = require('child_process').execSync('npm config get registry').toString('utf-8').trim();
	process.argv[3] = process.argv[3] || 'none';
	const MODES = ['none', 'patch', 'minor', 'major'];
	if (!MODES.includes(process.argv[3])) throw new Error(`invalid mode: ${process.argv[3]} (${MODES.join(' | ')})`);
	(async function main(registry: string, mode: Mode, file: string) {
		const pkg = (await JSON.read(file)) as Package;
		const { localChanged, remoteCurrent } = await bump(mode, pkg, registry);
		if (localChanged) {
			await JSON.write(file, pkg, { whitespace: '\t' });
			console.log(`${pkg.name} set to ${pkg.version} (${!remoteCurrent ? 'published' : 'to publish'})`);
		} else {
			console.log(`${pkg.name} is at ${pkg.version} (${!remoteCurrent ? 'published' : 'to publish'})`);
		}
	})(registry, process.argv[3] as Mode, process.argv[2] as string).catch((e) => {
		console.error(e);
		process.exit(2);
	});
}

export type Mode = 'none' | 'patch' | 'minor' | 'major';
export interface Package {
	name: string;
	version: string;
	[name: string]: any;
}

export async function bump(mode: Mode, packageJSON: Package, registry?: string) {
	const { version: original } = packageJSON;
	const version = await getVersion(packageJSON.name, registry);
	const next = mode !== 'none' ? semver.inc(version, mode) : version;
	if (!next) throw new Error(`failed to increment ${version}`);
	packageJSON.version = next;
	return {
		localChanged: original !== next,
		remoteCurrent: version !== next,
	};
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
