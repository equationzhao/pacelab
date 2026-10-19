"""Zero-dependency packer: inline CSS and source scripts into one portable HTML file."""
from pathlib import Path
import re
ROOT=Path(__file__).parent
html=(ROOT/'index.html').read_text(encoding='utf-8')
css=(ROOT/'assets/styles.css').read_text(encoding='utf-8')
css=re.sub(r"@import url\([^;]+;",'',css)
html=html.replace('  <link rel="icon" type="image/svg+xml" href="assets/icon.svg">\n','')
html=html.replace('<link rel="stylesheet" href="assets/styles.css">',f'<style>\n{css}\n</style>')
for name in ['core','tests','analysis','charts','app']:
    path=f'src/{name}.js'
    js=(ROOT/path).read_text(encoding='utf-8')
    html=html.replace(f'<script src="{path}"></script>',f'<script>\n{js}\n</script>')
output=ROOT/'dist'/'PaceLab_运动表现测试工作台.html'
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(html,encoding='utf-8')
print(f'{output.name}: {len(html):,} chars')
