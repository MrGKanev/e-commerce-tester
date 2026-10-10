#!/usr/bin/env node
'use strict';
const path = require('node:path');
const visual = require('./visual-baselines');
try {
  const [command, ...args] = process.argv.slice(2);
  const options = Object.fromEntries(
    args.map(arg => {
      const match = /^--(site|run|revision|ids)=(.+)$/.exec(arg);
      if (!match)
        throw new Error(
          'Use --site=slug --run=timestamp and, for approval, --revision=none|uuid --ids=id,id',
        );
      return [match[1], match[2]];
    }),
  );
  const reportsDir = path.join(__dirname, '..', 'reports');
  const root = visual.baselineRoot();
  if (command === 'review')
    console.log(
      JSON.stringify(visual.review(reportsDir, root, options.site, options.run), null, 2),
    );
  else if (command === 'approve' && options.revision && options.ids) {
    console.log(
      JSON.stringify(
        visual.approve({
          reportsDir,
          root,
          site: options.site,
          run: options.run,
          revision: options.revision === 'none' ? null : options.revision,
          ids: options.ids.split(','),
        }),
        null,
        2,
      ),
    );
  } else
    throw new Error(
      'Use review or approve. Approval requires the reviewed revision and explicitly selected screenshot IDs.',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
