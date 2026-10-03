"""Only for opt-in local acceptance: actual platform blueprints + temporary SQLite + test admin."""
import os
import sys
from flask import Flask
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from werkzeug.serving import make_server
SQLiteTypeCompiler.visit_BIT = lambda self, type_, **kw: 'INTEGER'
from core.extensions import db
from api.dyworker import dyworker_bp
from api.dyworker_admin import dyworker_admin_bp
from models.iam import IamApplication
from tests.dyworker_helpers import admin_ctx
app = Flask('dyworker-isolated-acceptance')
app.config.update(TESTING=True, SECRET_KEY='isolated-test-only',
    SQLALCHEMY_DATABASE_URI='sqlite:///' + sys.argv[1],
    SQLALCHEMY_ENGINE_OPTIONS={'execution_options': {'schema_translate_map': {'DAYAWAN': None}}},
    DYWORKER={key: 0 for key in ['register_hourly_limit_per_ip', 'batch_minute_limit_per_installation',
        'heartbeat_minute_limit_per_installation', 'message_pull_minute_limit_per_installation']})
db.init_app(app)
app.register_blueprint(dyworker_bp, url_prefix='/api/v1/dyworker')
app.register_blueprint(dyworker_admin_bp, url_prefix='/api/v1/dyworker/admin')
with app.app_context():
    db.create_all()
    db.session.add(IamApplication(app_id=888, code='dyworker', name='验收隔离应用', status='ENABLED'))
    db.session.commit()
with admin_ctx():
    server = make_server('127.0.0.1', 0, app, threaded=True)
    print('ACCEPTANCE_PORT=' + str(server.server_port), flush=True)
    server.serve_forever()
