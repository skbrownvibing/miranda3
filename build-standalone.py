#!/usr/bin/env python3
"""Bundle index.html + styles.css + the JS modules into one self-contained
miranda.html that runs from a plain file:// double-click (no local server, no
sibling files). Run: python3 build-standalone.py"""
import re

html = open('index.html').read()
css  = open('styles.css').read()
js   = '\n'.join(open(f).read() for f in ['core.js', 'sample-data.js', 'app.js'])

# Prevent inlined content from prematurely closing its wrapper tag.
js  = js.replace('</script>', '<\\/script>')
css = css.replace('</style>', '<\\/style>')

html = html.replace('<link rel="stylesheet" href="styles.css" />',
                    '<style>\n' + css + '\n</style>')

pat = re.compile(r'<script src="core\.js"></script>\s*'
                 r'<script src="sample-data\.js"></script>\s*'
                 r'<script src="app\.js"></script>')
html = pat.sub(lambda m: '<script>\n' + js + '\n</script>', html)

assert 'href="styles.css"' not in html, 'CSS not inlined'
assert 'src="core.js"' not in html and 'src="app.js"' not in html, 'JS not inlined'

open('miranda.html', 'w').write(html)
print('miranda.html built:', len(html), 'bytes')
