"""Extract a heading tree and exact source spans from the full teaching document."""
import re
import json
from pathlib import Path

DOCUMENT = Path(__file__).parent / 'data/example_artifacts/payment-spec-full.md'

def extract_document():
    text = DOCUMENT.read_text()
    summaries = json.loads(DOCUMENT.with_name('payment-spec-summaries.json').read_text())
    matches = list(re.finditer(r'^(#{1,6}) (.+)$', text, re.M))
    nodes, stack = [], []
    for index, match in enumerate(matches):
        level = len(match[1])
        end = next((m.start() for m in matches[index+1:] if len(m[1]) <= level), len(text))
        own_end = matches[index+1].start() if index+1 < len(matches) else len(text)
        node = dict(id=f'section-{index}', title=match[2], level=level,
                    start_line=text.count('\n',0,match.start())+1,
                    end_line=len(text[:end].rstrip().splitlines()),
                    text=text[match.end():own_end].strip(),
                    full_text=text[match.start():end].strip(), children=[])
        node['summary'] = summaries.get(node['title'], '')
        node['summary_origin'] = '人工编写的教学摘要'
        node['source_ids'] = {'4.1 重试规则':['demo:chunk:27'], '4.2 适用条件':['demo:chunk:28']}.get(node['title'],[])
        while stack and stack[-1]['level'] >= level: stack.pop()
        if stack: stack[-1]['children'].append(node)
        else: nodes.append(node)
        stack.append(node)
    return dict(title=nodes[0]['title'], filename=DOCUMENT.name, text=text, tree=nodes, heading_count=len(matches), line_count=len(text.splitlines()))
