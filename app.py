from flask import Flask, render_template, request, session, redirect, url_for, send_file, jsonify
from flask_socketio import SocketIO, emit, join_room
import random, string, time, socket, json, base64, os, sys
import qrcode
from io import BytesIO

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-change-me'
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=20 * 1024 * 1024)

rooms = {}

# ============================================
# CLOUDPUB URL — определяется динамически
# ============================================
cloudpub_url_current = None

def get_cloudpub_url():
    return cloudpub_url_current or ""

# ============================================
# ПУТИ
# ============================================
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    THEORY_FILES_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'data', 'files'))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    THEORY_FILES_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'Lumen-Desktop', 'data', 'files'))

print(f"[Lumen] THEORY_FILES_DIR = {THEORY_FILES_DIR}")
print(f"[Lumen] exists: {os.path.exists(THEORY_FILES_DIR)}")

current_lesson_material = {
    "material_id": None, "title": "", "questions": [], "theory": [],
    "show_theory_to_students": False,
}
current_lesson_class = {"class_id": None, "title": "", "students": []}

def gen_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))

def gen_token():
    return ''.join(random.choices(string.ascii_letters + string.digits, k=8))

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_ngrok_url():
    try:
        import urllib.request, json as _json
        req = urllib.request.Request("http://127.0.0.1:4040/api/tunnels")
        with urllib.request.urlopen(req, timeout=1.5) as r:
            data = _json.loads(r.read())
            for t in data.get('tunnels', []):
                if t.get('public_url', '').startswith('https://'):
                    return t['public_url']
    except Exception:
        return None
    return None

def analyze_text(text, keywords):
    if not text or not text.strip():
        return 'red', [], 0
    text_low = text.lower()
    matched = [kw for kw in keywords if kw and kw.lower() in text_low]
    score = len(matched)
    if not keywords:
        words = len(text.split())
        if words >= 10: return 'green', [], words
        elif words >= 4: return 'yellow', [], words
        else: return 'red', [], words
    total = len(keywords)
    ratio = score / total
    if ratio >= 0.5: return 'green', matched, score
    elif ratio >= 0.2: return 'yellow', matched, score
    else: return 'red', matched, score

def snapshot_question(room):
    if not room['question']:
        return
    # Защита от дублей: если такой же вопрос уже последний в history — не пишем
    if room['history'] and room['history'][-1].get('question') == room['question']:
        return

    answers = room['answers']
    g = sum(1 for v in answers.values() if v.get('color') == 'green')
    y = sum(1 for v in answers.values() if v.get('color') == 'yellow')
    r = sum(1 for v in answers.values() if v.get('color') == 'red')
    none = sum(1 for v in answers.values() if not v.get('color'))
    texts = {k: v.get('text', '') for k, v in answers.items()}
    room['history'].append({
        "question": room['question'],
        "green": g, "yellow": y, "red": r, "none": none,
        "total_answered": g + y + r,
        "snapshot": {k: v.get('color') for k, v in answers.items()},
        "names": {k: v['name'] for k, v in answers.items()},
        "anon_nums": {k: v['anon_num'] for k, v in answers.items()},
        "texts": texts,
    })

def find_room_by_token(token):
    for code, room in rooms.items():
        if room.get('invite_token') == token:
            return code, room
    return None, None

def is_student_in_class(name):
    if not current_lesson_class['students']: return None
    name_norm = name.strip().lower()
    for s in current_lesson_class['students']:
        if s.strip().lower() == name_norm: return True
    return False

# ============================================
# HTTP
# ============================================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/teacher')
def teacher():
    code = gen_code()
    token = gen_token()
    rooms[code] = {
        "question": "", "answers": {}, "history": [], "anonymous": False,
        "picked": None, "invite_token": token, "invited_count": 0,
        "questions": [], "reactions": [],
        "mode": "buttons", "keywords": [],
        "quiz_options": [], "quiz_correct": None,
        "voice_enabled": False,
        "button_set": "understanding",
    }
    session['room'] = code
    return render_template('teacher.html', code=code, invite_token=token, cloudpub_url=get_cloudpub_url())

@app.route('/api/set-cloudpub-url', methods=['POST'])
def api_set_cloudpub_url():
    global cloudpub_url_current
    data = request.get_json() or {}
    cloudpub_url_current = data.get('url', '') or ''
    print(f"[Lumen] CloudPub URL установлен: {cloudpub_url_current}")
    return jsonify({"ok": True, "url": cloudpub_url_current})

@app.route('/api/set-lesson-material', methods=['POST'])
def api_set_lesson_material():
    global current_lesson_material
    data = request.get_json()
    if not data:
        current_lesson_material = {"material_id": None, "title": "", "questions": [], "theory": [], "show_theory_to_students": False}
        return jsonify({"ok": True, "material": None})
    current_lesson_material = {
        "material_id": data.get('id'),
        "title": data.get('title', ''),
        "subject": data.get('subject', ''),
        "grade": data.get('grade', ''),
        "questions": data.get('questions', []),
        "theory": data.get('theory', []),
        "show_theory_to_students": bool(data.get('show_theory_to_students', False)),
    }
    print(f"[Electron] Материал: {current_lesson_material['title']}")
    socketio.emit('lesson_material_update', current_lesson_material, to='teacher_all')
    return jsonify({"ok": True, "material": current_lesson_material})

@app.route('/api/get-lesson-material')
def api_get_lesson_material():
    return jsonify(current_lesson_material)

@app.route('/theory-file/<filename>')
def theory_file(filename):
    if '..' in filename or '/' in filename or '\\' in filename:
        return "Forbidden", 403
    filepath = os.path.join(THEORY_FILES_DIR, filename)
    if not os.path.exists(filepath):
        return "Not found", 404
    return send_file(filepath)

@app.route('/api/set-lesson-class', methods=['POST'])
def api_set_lesson_class():
    global current_lesson_class
    data = request.get_json()
    if not data:
        current_lesson_class = {"class_id": None, "title": "", "students": []}
        return jsonify({"ok": True, "class": None})
    current_lesson_class = {
        "class_id": data.get('id'),
        "title": data.get('title', ''),
        "students": data.get('students', [])
    }
    print(f"[Electron] Класс: {current_lesson_class['title']}")
    socketio.emit('lesson_class_update', current_lesson_class, to='teacher_all')
    return jsonify({"ok": True, "class": current_lesson_class})

@app.route('/api/get-lesson-class')
def api_get_lesson_class():
    return jsonify(current_lesson_class)

@app.route('/api/finish-lesson', methods=['POST'])
def api_finish_lesson():
    data = request.get_json() or {}
    print(f"[Electron] Урок завершён: {data}")
    return jsonify({"ok": True})

@app.route('/diagnostics')
def diagnostics():
    return render_template('diagnostics.html')

@app.route('/api/status')
def api_status():
    ngrok_url = get_ngrok_url()
    cloudpub_url = get_cloudpub_url()
    local_ip = get_local_ip()
    port = 5000
    addresses = [
        {"type": "cloudpub", "label": "CloudPub (без VPN)", "url": cloudpub_url or None, "available": bool(cloudpub_url), "note": "Работает из любой сети без VPN"},
        {"type": "ngrok", "label": "Ngrok (с VPN)", "url": ngrok_url, "available": bool(ngrok_url), "note": "Резерв"},
        {"type": "local", "label": "Локальная сеть", "url": f"http://{local_ip}:{port}", "available": True, "note": "Без интернета"},
        {"type": "localhost", "label": "Localhost", "url": f"http://localhost:{port}", "available": True, "note": "Только на этом ПК"}
    ]
    return jsonify({"addresses": addresses, "ts": int(time.time())})

@app.route('/fallback')
def fallback():
    local_ip = get_local_ip()
    return render_template('fallback.html', local_ip=local_ip)

@app.route('/join/<token>')
def join_by_token(token):
    code, room = find_room_by_token(token)
    if not code:
        return render_template('join.html', error="Ссылка недействительна")
    room['invited_count'] = room.get('invited_count', 0) + 1
    socketio.emit('invited_update', {"invited_count": room['invited_count']}, to=f"teacher-{code}")
    return render_template('join.html', code=code, token=token)

@app.route('/join/<token>/enter', methods=['POST'])
def join_enter(token):
    code, room = find_room_by_token(token)
    if not code:
        return render_template('join.html', error="Ссылка недействительна")
    name = request.form.get('name', '').strip()
    if not name or ' ' not in name:
        return render_template('join.html', code=code, token=token, error="Введи Фамилию и Имя через пробел")
    session['room'] = code
    session['name'] = name
    session['sid_key'] = f"{name}-{random.randint(1000,9999)}"
    return render_template('student.html', code=code, name=name)

@app.route('/qr')
def qr():
    base = get_cloudpub_url()
    if not base: return "CloudPub URL не установлен", 503
    img = qrcode.make(f"{base}/student")
    buf = BytesIO(); img.save(buf, format='PNG'); buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/qr-join/<token>')
def qr_join(token):
    base = get_cloudpub_url()
    if not base: return "CloudPub URL не установлен", 503
    img = qrcode.make(f"{base}/join/{token}")
    buf = BytesIO(); img.save(buf, format='PNG'); buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/qr-fallback')
def qr_fallback():
    local_ip = get_local_ip()
    img = qrcode.make(f"http://{local_ip}:5000/student")
    buf = BytesIO(); img.save(buf, format='PNG'); buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/qr-fallback-join/<token>')
def qr_fallback_join(token):
    local_ip = get_local_ip()
    img = qrcode.make(f"http://{local_ip}:5000/join/{token}")
    buf = BytesIO(); img.save(buf, format='PNG'); buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/student', methods=['GET', 'POST'])
def student():
    if request.method == 'POST':
        code = request.form['code'].strip().upper()
        name = request.form['name'].strip()
        if not name or ' ' not in name:
            return render_template('student.html', error="Введи Фамилию и Имя через пробел")
        if code not in rooms:
            return render_template('student.html', error="Нет такой комнаты")
        session['room'] = code
        session['name'] = name
        session['sid_key'] = f"{name}-{random.randint(1000,9999)}"
        return render_template('student.html', code=code, name=name)
    return render_template('student.html')

# ============================================
# SOCKET.IO
# ============================================
@socketio.on('teacher_join')
def on_teacher_join(data):
    code = data['code']
    join_room(f"teacher-{code}")
    join_room('teacher_all')
    room = rooms.get(code, {})
    emit('state', room)
    emit('student_list', room.get('answers', {}))
    emit('questions_update', room.get('questions', []))
    emit('reactions_update', room.get('reactions', []))
    emit('mode_update', {"mode": room.get('mode', 'buttons'), "keywords": room.get('keywords', []), "voice_enabled": room.get('voice_enabled', False), "button_set": room.get('button_set', 'understanding'),})
    emit('lesson_material_update', current_lesson_material)
    emit('lesson_class_update', current_lesson_class)
    emit('history_update', room.get('history', []))

last_event_time = {}

def should_process(key, min_interval=0.15):
    now = time.time()
    last = last_event_time.get(key, 0)
    if now - last < min_interval: return False
    last_event_time[key] = now
    return True

@socketio.on('student_join')
def on_student_join(data):
    code = data['code']
    name = data['name']
    key = data.get('key') or name
    room = rooms.get(code)
    if not room:
        emit('error', {'msg': 'Комната не найдена'})
        return
    in_class = is_student_in_class(name)
    if key in room['answers']:
        room['answers'][key]['focused'] = True
        room['answers'][key]['in_class'] = in_class
        anon_num = room['answers'][key]['anon_num']
    else:
        anon_num = len(room['answers']) + 1
        room['answers'][key] = {
            "name": name, "color": None, "anon_num": anon_num,
            "hand": False, "focused": True, "text": "",
            "quiz_choice": None, "voice": None, "in_class": in_class
        }
    join_room(f"students-{code}")
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")
    show_theory_flag = bool(current_lesson_material.get('show_theory_to_students', False))
    emit('joined', {
        'name': name, 'key': key, 'anon_num': anon_num,
        'anonymous': room['anonymous'],
        'mode': room.get('mode', 'buttons'),
        'voice_enabled': room.get('voice_enabled', False),
        'show_theory': show_theory_flag,
        'button_set': room.get('button_set', 'understanding'),
    })

@socketio.on('student_left')
def on_student_left(data):
    code = data['code']; key = data['key']
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    room['answers'][key]['focused'] = False
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('set_mode')
def on_set_mode(data):
    code = data['code']; mode = data.get('mode', 'buttons')
    if mode not in ('buttons', 'text', 'both', 'quiz', 'voice'): mode = 'buttons'
    room = rooms.get(code)
    if not room: return
    room['mode'] = mode
    payload = {"mode": mode, "keywords": room.get('keywords', []), "voice_enabled": room.get('voice_enabled', False), 'button_set': room.get('button_set', 'understanding'),}
    socketio.emit('mode_update', payload, to=f"teacher-{code}")
    socketio.emit('mode_update', payload, to=f"students-{code}")

@socketio.on('set_button_set')
def on_set_button_set(data):
    code = data['code']
    button_set = data.get('button_set', 'understanding')
    if button_set not in ('understanding', 'yesno'):
        button_set = 'understanding'
    room = rooms.get(code)
    if not room:
        return
    room['button_set'] = button_set
    payload = {
        "button_set": button_set,
        "mode": room.get('mode', 'buttons'),
        "keywords": room.get('keywords', []),
        "voice_enabled": room.get('voice_enabled', False),
    }
    socketio.emit('mode_update', payload, to=f"teacher-{code}")
    socketio.emit('mode_update', payload, to=f"students-{code}")

@socketio.on('set_keywords')
def on_set_keywords(data):
    code = data['code']; kws = data.get('keywords', [])
    kws = [str(k).strip().lower() for k in kws if str(k).strip()][:20]
    room = rooms.get(code)
    if not room: return
    room['keywords'] = kws
    payload = {"mode": room.get('mode', 'buttons'), "keywords": kws, "voice_enabled": room.get('voice_enabled', False)}
    socketio.emit('mode_update', payload, to=f"teacher-{code}")
    for v in room['answers'].values():
        if v.get('text'):
            color, matched, score = analyze_text(v['text'], kws)
            v['color'] = color; v['matched'] = matched; v['score'] = score
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('set_voice_enabled')
def on_set_voice_enabled(data):
    code = data['code']; enabled = bool(data.get('enabled', False))
    room = rooms.get(code)
    if not room: return
    room['voice_enabled'] = enabled
    payload = {"mode": room.get('mode', 'buttons'), "keywords": room.get('keywords', []), "voice_enabled": enabled}
    socketio.emit('mode_update', payload, to=f"teacher-{code}")
    socketio.emit('mode_update', payload, to=f"students-{code}")

@socketio.on('new_question')
def on_new_question(data):
    code = data['code']; q = data['question']
    timer = int(data.get('timer', 0)); mode = data.get('mode', 'buttons')
    quiz_options = data.get('quiz_options', []); quiz_correct = data.get('quiz_correct')
    room = rooms.get(code)
    if not room: return
    snapshot_question(room)
    room['question'] = q; room['picked'] = None; room['mode'] = mode
    room['quiz_options'] = quiz_options; room['quiz_correct'] = quiz_correct
    for v in room['answers'].values():
        v['color'] = None; v['hand'] = False; v['text'] = ''
        v['matched'] = []; v['score'] = 0; v['quiz_choice'] = None; v['voice'] = None
    payload = {'question': q, 'timer': timer, 'mode': mode, 'keywords': room.get('keywords', []), 'quiz_options': quiz_options, 'voice_enabled': room.get('voice_enabled', False)}
    socketio.emit('question', payload, to=f"students-{code}")
    socketio.emit('question', payload, to=f"teacher-{code}")
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")
    socketio.emit('history_update', room['history'], to=f"teacher-{code}")
    socketio.emit('picked_clear', to=f"students-{code}")
    socketio.emit('picked_clear', to=f"teacher-{code}")
@socketio.on('clear_question')
def on_clear_question(data):
    """Учитель завершает вопрос — ученики возвращаются к экрану ожидания"""
    code = data['code']
    room = rooms.get(code)
    if not room:
        return
    snapshot_question(room)
    room['question'] = ''
    room['quiz_options'] = []
    room['quiz_correct'] = None
    room['picked'] = None
    for v in room['answers'].values():
        v['color'] = None
        v['hand'] = False
        v['text'] = ''
        v['matched'] = []
        v['score'] = 0
        v['quiz_choice'] = None
        v['voice'] = None
    # Ученикам — вернуться к экрану ожидания
    socketio.emit('question_cleared', to=f"students-{code}")
    # Учителю — сбросить отображение и карту
    socketio.emit('question_cleared', to=f"teacher-{code}")
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")
    socketio.emit('history_update', room['history'], to=f"teacher-{code}")
@socketio.on('answer')
def on_answer(data):
    code = data['code']; key = data['key']; color = data['color']
    if not should_process(f"answer-{key}", 0.15): return
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    if room['answers'][key].get('color') == color: return
    room['answers'][key]['color'] = color
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('answer_text')
def on_answer_text(data):
    code = data['code']; key = data['key']
    text = data.get('text', '').strip()[:2000]
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    room['answers'][key]['text'] = text
    color, matched, score = analyze_text(text, room.get('keywords', []))
    room['answers'][key]['color'] = color; room['answers'][key]['matched'] = matched; room['answers'][key]['score'] = score
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('answer_quiz')
def on_answer_quiz(data):
    code = data['code']; key = data['key']; choice = data.get('choice')
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    room['answers'][key]['quiz_choice'] = choice
    correct = room.get('quiz_correct')
    if correct is not None and choice is not None:
        if int(choice) == int(correct): room['answers'][key]['color'] = 'green'
        else: room['answers'][key]['color'] = 'red'
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")
    is_correct = (correct is not None and choice is not None and int(choice) == int(correct))
    emit('quiz_result', {"correct": is_correct, "choice": choice}, to=request.sid)

@socketio.on('answer_voice')
def on_answer_voice(data):
    code = data['code']; key = data['key']
    voice = data.get('voice', ''); duration = data.get('duration', 0)
    if not voice or len(voice) > 15_000_000: return
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    room['answers'][key]['voice'] = voice
    room['answers'][key]['voice_duration'] = duration
    room['answers'][key]['color'] = 'green'
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('raise_hand')
def on_raise_hand(data):
    code = data['code']; key = data['key']
    if not should_process(f"hand-{key}", 0.2): return
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    room['answers'][key]['hand'] = not room['answers'][key].get('hand', False)
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('focus_change')
def on_focus_change(data):
    code = data['code']; key = data['key']
    focused = bool(data.get('focused', True))
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    room['answers'][key]['focused'] = focused
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('reset')
def on_reset(data):
    code = data['code']
    room = rooms.get(code)
    if not room: return
    for v in room['answers'].values():
        v['color'] = None; v['hand'] = False; v['text'] = ''
        v['matched'] = []; v['score'] = 0; v['quiz_choice'] = None; v['voice'] = None
    room['picked'] = None
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")
    socketio.emit('picked_clear', to=f"students-{code}")
    socketio.emit('picked_clear', to=f"teacher-{code}")

@socketio.on('toggle_anonymous')
def on_toggle_anonymous(data):
    code = data['code']
    room = rooms.get(code)
    if not room: return
    room['anonymous'] = bool(data.get('value'))
    socketio.emit('anonymous_mode', {"anonymous": room['anonymous']}, to=f"students-{code}")
    socketio.emit('student_list', room['answers'], to=f"teacher-{code}")

@socketio.on('pick_random')
def on_pick_random(data):
    code = data['code']; mode = data.get('mode', 'answered')
    room = rooms.get(code)
    if not room: return
    if mode == 'answered':
        candidates = [k for k, v in room['answers'].items() if v.get('color')]
    else:
        candidates = list(room['answers'].keys())
    if not candidates:
        emit('picked_none'); return
    picked_key = random.choice(candidates)
    room['picked'] = picked_key
    info = room['answers'][picked_key]
    payload = {"key": picked_key, "name": info['name'], "anon_num": info['anon_num'], "anonymous": room['anonymous']}
    socketio.emit('picked_student', payload, to=f"students-{code}")
    socketio.emit('picked_student', payload, to=f"teacher-{code}")

@socketio.on('student_question')
def on_student_question(data):
    code = data['code']; key = data['key']
    text = data.get('text', '').strip()
    if not text: return
    if not should_process(f"q-{key}", 1.0): return
    room = rooms.get(code)
    if not room or key not in room['answers']: return
    info = room['answers'][key]
    q = {"id": f"q{int(time.time()*1000)}{random.randint(100,999)}", "text": text[:500], "name": info['name'], "anon_num": info['anon_num'], "ts": int(time.time()), "answered": False, "anonymous": room['anonymous']}
    room['questions'].append(q)
    if len(room['questions']) > 100: room['questions'] = room['questions'][-100:]
    socketio.emit('questions_update', room['questions'], to=f"teacher-{code}")

@socketio.on('mark_question')
def on_mark_question(data):
    code = data['code']; qid = data['id']; action = data.get('action', 'answered')
    room = rooms.get(code)
    if not room: return
    if action == 'delete':
        room['questions'] = [q for q in room['questions'] if q['id'] != qid]
    else:
        for q in room['questions']:
            if q['id'] == qid:
                q['answered'] = not q.get('answered', False)
                break
    socketio.emit('questions_update', room['questions'], to=f"teacher-{code}")

@socketio.on('reaction')
def on_reaction(data):
    code = data['code']; key = data.get('key'); emoji = data.get('emoji', '')
    allowed = {'👍','🤔','❓','🔥','😂','😮','👏','💡'}
    if emoji not in allowed: return
    if key and not should_process(f"reaction-{key}", 0.5): return
    room = rooms.get(code)
    if not room: return
    name = ''; anon_num = 0
    if key and key in room['answers']:
        info = room['answers'][key]; name = info['name']; anon_num = info['anon_num']
    r = {"id": f"r{int(time.time()*1000)}{random.randint(100,999)}", "emoji": emoji, "ts": int(time.time()), "name": name, "anon_num": anon_num, "anonymous": room['anonymous']}
    room['reactions'].append(r)
    if len(room['reactions']) > 30: room['reactions'] = room['reactions'][-30:]
    socketio.emit('reactions_update', room['reactions'], to=f"teacher-{code}")

@socketio.on('finish_lesson')
def on_finish_lesson(data):
    code = data['code']
    room = rooms.get(code)
    if not room: return
    snapshot_question(room)
    history = room['history']
    total_q = len(history)
    total_answered = sum(h['total_answered'] for h in history)
    total_green = sum(h['green'] for h in history)
    avg_green_pct = (100 * total_green / total_answered) if total_answered else 0
    summary = {
        "total_questions": total_q, "total_answered": total_answered,
        "avg_green_pct": round(avg_green_pct, 1), "history": history,
        "questions_count": len(room['questions']),
        "reactions_count": len(room['reactions']),
        "material_id": current_lesson_material.get('material_id'),
        "material_title": current_lesson_material.get('title', ''),
        "class_id": current_lesson_class.get('class_id'),
        "class_title": current_lesson_class.get('title', ''),
        "students_count": len(room['answers']),
        "students": [                          
            {
                'key': k,
                'name': v.get('name', ''),
                'anon_num': v.get('anon_num', 0),
                'color': v.get('color'),
                'quiz_choice': v.get('quiz_choice'),
                'text': v.get('text', ''),
            }
            for k, v in room['answers'].items()
        ]
    }
    socketio.emit('lesson_summary', summary, to=f"teacher-{code}")

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)