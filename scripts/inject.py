import sys, os, shutil, subprocess, plistlib
import lief

ipa, gadget, js = sys.argv[1], sys.argv[2], sys.argv[3]
work = "build"
shutil.rmtree(work, ignore_errors=True)
os.makedirs(work)
subprocess.run(["unzip", "-q", ipa, "-d", work], check=True)

app = None
for root, dirs, files in os.walk(work):
    for d in dirs:
        if d.endswith(".app"):
            app = os.path.join(root, d)
if not app:
    sys.exit("sin .app")

fw = os.path.join(app, "Frameworks")
os.makedirs(fw, exist_ok=True)
shutil.copy(gadget, os.path.join(fw, "FridaGadget.dylib"))
shutil.copy(js, os.path.join(fw, "panel.js"))
shutil.copy("ios/FridaGadget.config", os.path.join(fw, "FridaGadget.config"))

with open(os.path.join(app, "Info.plist"), "rb") as f:
    info = plistlib.load(f)
exe = os.path.join(app, info["CFBundleExecutable"])

b = lief.parse(exe)
if b.has_code_signature:
    b.remove_signature()
b.add_library("@executable_path/Frameworks/FridaGadget.dylib")
b.write(exe)

out = "Trompeta.ipa"
if os.path.exists(out):
    os.remove(out)
subprocess.run(["zip", "-qry", out, "."], cwd=work, check=True)
print("OK")
