#!/usr/bin/env python3
"""Собирает готовую колоду «Английский B2–C1» из decks/src/*.txt.

Результат (в папке decks/):
  english-b2-c1.unki.json — для импорта в Unki (Файл → Импорт);
  english-b2-c1.apkg      — для импорта в Anki (формат collection.anki2, schema 11).

Формат строки в decks/src/*.txt:  слово|часть речи|перевод|Пример с *формой слова*.
Служебные строки:  #level=B2  и  #theme=название темы.

Запуск:  python3 decks/build.py
"""
import glob
import hashlib
import html
import json
import os
import re
import sqlite3
import string
import sys
import tempfile
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT_JSON = os.path.join(HERE, 'english-b2-c1.unki.json')
OUT_APKG = os.path.join(HERE, 'english-b2-c1.apkg')

ROOT_DECK = 'Английский B2-C1'
NT_ID = 'en-vocab-b2c1'
NT_NAME = 'Английская лексика (EN→RU)'
FIELDS = ['Слово', 'Часть речи', 'Перевод', 'Пример']
POS_RU = {
    'n': 'сущ.', 'v': 'гл.', 'adj': 'прил.', 'adv': 'нареч.', 'prep': 'предлог',
    'phr': 'выражение', 'phr v': 'фразовый гл.', 'conj': 'союз', 'pron': 'мест.', 'interj': 'межд.',
}
QFMT = '<div class="word">{{Слово}} {{tts en_US:Слово}}</div>\n<div class="pos">{{Часть речи}}</div>'
AFMT = ('{{FrontSide}}\n\n<hr id=answer>\n\n<div class="tr">{{Перевод}}</div>\n'
        '{{#Пример}}<div class="ex">{{Пример}} {{tts en_US:Пример}}</div>{{/Пример}}')
CSS = """.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
}
.word { font-size: 34px; font-weight: bold; }
.pos { color: #888; font-style: italic; margin-top: 4px; }
.tr { font-size: 26px; color: #1a5fb4; }
.ex { margin-top: 16px; color: #444; font-size: 18px; }
.ex b { color: #1a5fb4; }
.nightMode .tr, .nightMode .ex b { color: #8ab4f8; }
.nightMode .ex { color: #bbb; }
"""

# фиксированные идентификаторы — сборка воспроизводима
BASE_MS = 1760000000000
MODEL_ID = BASE_MS + 1
DECK_IDS = {ROOT_DECK: BASE_MS + 10, ROOT_DECK + '::B2': BASE_MS + 11, ROOT_DECK + '::C1': BASE_MS + 12}
CRT = 1759276800  # начало «дня» коллекции (сек)


def slug(s):
    return re.sub(r'_+', '_', re.sub(r'[^\w]+', '_', s.strip(), flags=re.UNICODE)).strip('_')


def fmt_example(s):
    return re.sub(r'\*(.+?)\*', r'<b>\1</b>', html.escape(s, quote=False))


def load():
    entries = []
    for path in sorted(glob.glob(os.path.join(SRC, '*.txt'))):
        level, theme = '', ''
        for n, line in enumerate(open(path, encoding='utf-8').read().split('\n'), 1):
            line = line.strip()
            if not line:
                continue
            if line.startswith('#'):
                k, _, v = line[1:].partition('=')
                if k == 'level': level = v.strip()
                elif k == 'theme': theme = v.strip()
                continue
            parts = line.split('|')
            if len(parts) != 4:
                sys.exit(f'{os.path.basename(path)}:{n}: ожидается 4 поля, найдено {len(parts)}')
            word, pos, tr, ex = (p.strip() for p in parts)
            if pos not in POS_RU:
                sys.exit(f'{os.path.basename(path)}:{n}: неизвестная часть речи «{pos}»')
            entries.append(dict(word=word, pos=pos, tr=tr, ex=ex, level=level, theme=theme))
    seen = set()
    for e in entries:
        k = e['word'].lower()
        if k in seen:
            sys.exit(f'дубликат слова: {e["word"]}')
        seen.add(k)
    return entries


def note_fields(e):
    return [html.escape(e['word'], quote=False), POS_RU[e['pos']], html.escape(e['tr'], quote=False), fmt_example(e['ex'])]


def note_tags(e):
    return [e['level'], e['pos'].replace(' ', '_'), 'тема_' + slug(e['theme'])]


def deck_name(e):
    return f'{ROOT_DECK}::{e["level"]}'



def build_unki_json(entries):
    notes, cards = [], []
    now = int(time.time() * 1000)
    for i, e in enumerate(entries):
        nid = BASE_MS + 1000 + i
        cid = BASE_MS + 100000 + i
        notes.append({'id': nid, 'tid': NT_ID, 'fields': note_fields(e), 'tags': note_tags(e), 'mod': now})
        cards.append({
            'id': cid, 'nid': nid, 'ord': 0, 'did': DECK_IDS[deck_name(e)], 'type': 0, 'due': i + 1,
            'ivl': 0, 'factor': 0, 'reps': 0, 'lapses': 0, 'step': 0, 'flag': 0, 'susp': False,
            'buried': -1, 'mod': now, 'created': cid,
        })
    note_type = {
        'id': NT_ID, 'name': NT_NAME, 'kind': 'normal', 'builtin': False, 'fields': FIELDS, 'sortField': 0,
        'css': CSS, 'templates': [{'name': 'EN → RU', 'qfmt': QFMT, 'afmt': AFMT}],
    }
    decks = [{'id': DECK_IDS[n], 'name': n, 'desc': ''} for n in (ROOT_DECK + '::B2', ROOT_DECK + '::C1')]
    return {
        'format': 'unki-deck', 'version': 1, 'exported': now, 'includesScheduling': False,
        'decks': decks, 'noteTypes': [note_type], 'notes': notes, 'cards': cards, 'revlog': [],
    }


_B91 = string.ascii_letters + string.digits + "!#$%&()*+,-./:;<=>?@[]^_`{|}~"


def guid_for(*values):
    h = hashlib.sha256('__'.join(map(str, values)).encode('utf-8')).digest()
    n = int.from_bytes(h[:8], 'big')
    out = []
    while n > 0:
        out.append(_B91[n % len(_B91)])
        n //= len(_B91)
    return ''.join(reversed(out))


def strip_html(s):
    return re.sub(r'<[^>]*>', '', s)


def csum(s):
    return int(hashlib.sha1(strip_html(s).encode('utf-8')).hexdigest()[:8], 16)


def build_apkg(entries, path):
    now_s = int(time.time())
    now_ms = now_s * 1000
    fd, tmp = tempfile.mkstemp(suffix='.anki2')
    os.close(fd)
    os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript("""
    CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
      ver integer not null, dty integer not null, usn integer not null, ls integer not null,
      conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
      usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
      flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
      mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
      ivl integer not null, factor integer not null, reps integer not null, lapses integer not null,
      left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
    CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
      ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid);
    CREATE INDEX ix_notes_csum on notes (csum);
    """)

    conf = {
        'nextPos': len(entries) + 1, 'estTimes': True, 'activeDecks': [1], 'sortType': 'noteFld', 'timeLim': 0,
        'sortBackwards': False, 'addToCur': True, 'curDeck': 1, 'newBury': True, 'newSpread': 0, 'dueCounts': True,
        'curModel': str(MODEL_ID), 'collapseTime': 1200,
    }
    model = {
        'id': MODEL_ID, 'name': NT_NAME, 'type': 0, 'mod': now_s, 'usn': -1, 'sortf': 0, 'did': DECK_IDS[ROOT_DECK + '::B2'],
        'tmpls': [{'name': 'EN → RU', 'ord': 0, 'qfmt': QFMT, 'afmt': AFMT, 'bqfmt': '', 'bafmt': '', 'did': None, 'bfont': '', 'bsize': 0}],
        'flds': [{'name': f, 'ord': i, 'sticky': False, 'rtl': False, 'font': 'Arial', 'size': 20, 'media': []} for i, f in enumerate(FIELDS)],
        'css': CSS, 'latexPre': '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        'latexPost': '\\end{document}', 'latexsvg': False, 'req': [[0, 'any', [0, 1]]], 'tags': [], 'vers': [],
    }

    def deck(did, name, desc=''):
        return {
            'id': did, 'mod': now_s, 'name': name, 'usn': -1, 'lrnToday': [0, 0], 'revToday': [0, 0], 'newToday': [0, 0],
            'timeToday': [0, 0], 'collapsed': False, 'browserCollapsed': False, 'desc': desc, 'dyn': 0, 'conf': 1,
            'extendNew': 10, 'extendRev': 50,
        }

    decks = {'1': deck(1, 'Default')}
    for name, did in DECK_IDS.items():
        decks[str(did)] = deck(did, name, 'Словарь уровней B2–C1: слово → перевод, часть речи, пример.' if name == ROOT_DECK else '')
    dconf = {'1': {
        'id': 1, 'mod': 0, 'name': 'Default', 'usn': 0, 'maxTaken': 60, 'autoplay': True, 'timer': 0, 'replayq': True,
        'new': {'bury': True, 'delays': [1, 10], 'initialFactor': 2500, 'ints': [1, 4, 7], 'order': 1, 'perDay': 20, 'separate': True},
        'lapse': {'delays': [10], 'leechAction': 0, 'leechFails': 8, 'minInt': 1, 'mult': 0},
        'rev': {'bury': True, 'ease4': 1.3, 'fuzz': 0.05, 'ivlFct': 1, 'maxIvl': 36500, 'minSpace': 1, 'perDay': 100},
        'dyn': False,
    }}
    db.execute('INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)', (
        CRT, now_ms, now_ms, json.dumps(conf), json.dumps({str(MODEL_ID): model}, ensure_ascii=False),
        json.dumps(decks, ensure_ascii=False), json.dumps(dconf), '{}'))

    for i, e in enumerate(entries):
        nid = BASE_MS + 1000 + i
        cid = BASE_MS + 100000 + i
        flds = note_fields(e)
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)', (
            nid, guid_for('unki-en-b2c1', e['word']), MODEL_ID, now_s, -1, ' ' + ' '.join(note_tags(e)) + ' ',
            '\x1f'.join(flds), strip_html(flds[0]), csum(flds[0]), 0, ''))
        db.execute('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
            cid, nid, DECK_IDS[deck_name(e)], 0, now_s, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ''))
    db.commit()
    db.close()

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(tmp, 'collection.anki2')
        z.writestr('media', '{}')
    os.remove(tmp)


def main():
    entries = load()
    by_level = {}
    for e in entries:
        by_level[e['level']] = by_level.get(e['level'], 0) + 1
    print(f'Слов: {len(entries)}', by_level)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(build_unki_json(entries), f, ensure_ascii=False, separators=(',', ':'))
    build_apkg(entries, OUT_APKG)
    for p in (OUT_JSON, OUT_APKG):
        print(f'{os.path.relpath(p, HERE)}: {os.path.getsize(p) / 1024:.0f} КБ')


if __name__ == '__main__':
    main()
