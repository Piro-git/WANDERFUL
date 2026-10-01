#!/usr/bin/env python3
"""Create a dependency-free diagnostic project in a new directory, never the shipping project."""
import pathlib
import plistlib
import shutil
import sys

source = pathlib.Path(__file__).resolve().parent
out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=False)
shutil.copytree(source / 'App', out / 'App')
shutil.copytree(source / 'Tests', out / 'Tests')
shutil.copyfile(source / 'Minimal.storekit', out / 'App/Minimal.storekit')
shutil.copyfile(source.parents[1] / 'TrailMindTests/StoreKit/Wanderful.storekit', out / 'App/Wanderful.storekit')
objects = {}
def add(key, isa, **values):
    objects[key] = {'isa': isa, **values}
    return key

def configs(name, settings):
    add(name + 'Debug', 'XCBuildConfiguration', name='Debug', buildSettings=settings)
    add(name + 'Configs', 'XCConfigurationList', buildConfigurations=[name + 'Debug'], defaultConfigurationIsVisible=0, defaultConfigurationName='Debug')
    return name + 'Configs'

# Symbolic object IDs are serialized as standard Xcode property-list references.
app = 'A10000000000000000000001'
tests = 'A10000000000000000000002'
project = 'A10000000000000000000003'
add('AppGroup', 'PBXFileSystemSynchronizedRootGroup', path='App', sourceTree='<group>')
add('TestsGroup', 'PBXFileSystemSynchronizedRootGroup', path='Tests', sourceTree='<group>')
add('AppProduct', 'PBXFileReference', explicitFileType='wrapper.application', path='Probe.app', sourceTree='BUILT_PRODUCTS_DIR')
add('TestsProduct', 'PBXFileReference', explicitFileType='wrapper.cfbundle', path='ProbeTests.xctest', sourceTree='BUILT_PRODUCTS_DIR')
add('Products', 'PBXGroup', name='Products', children=['AppProduct', 'TestsProduct'], sourceTree='<group>')
add('Main', 'PBXGroup', children=['AppGroup', 'TestsGroup', 'Products'], sourceTree='<group>')
for prefix in ['App', 'Tests']:
    for phase in ['Sources', 'Resources', 'Frameworks']:
        add(prefix + phase, 'PBX' + phase + 'BuildPhase', buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
add('Proxy', 'PBXContainerItemProxy', containerPortal=project, proxyType=1, remoteGlobalIDString=app, remoteInfo='Probe')
add('Dependency', 'PBXTargetDependency', target=app, targetProxy='Proxy')
common = {'SDKROOT': 'iphoneos', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0', 'SWIFT_VERSION': '5.0', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone', 'ENABLE_TESTABILITY': 'YES', 'GENERATE_INFOPLIST_FILE': 'YES', 'CODE_SIGN_IDENTITY': '-', 'CODE_SIGNING_ALLOWED': 'YES', 'TARGETED_DEVICE_FAMILY': '1,2'}
add(app, 'PBXNativeTarget', name='Probe', productName='Probe', productReference='AppProduct', productType='com.apple.product-type.application', buildConfigurationList=configs('App', {**common, 'PRODUCT_NAME': 'Probe', 'PRODUCT_BUNDLE_IDENTIFIER': 'test.local.storekit.probe', 'INFOPLIST_KEY_UILaunchScreen_Generation': 'YES'}), buildPhases=['AppSources', 'AppFrameworks', 'AppResources'], buildRules=[], dependencies=[], fileSystemSynchronizedGroups=['AppGroup'])
add(tests, 'PBXNativeTarget', name='ProbeTests', productName='ProbeTests', productReference='TestsProduct', productType='com.apple.product-type.bundle.unit-test', buildConfigurationList=configs('Tests', {**common, 'PRODUCT_NAME': 'ProbeTests', 'PRODUCT_BUNDLE_IDENTIFIER': 'test.local.storekit.probe.tests', 'TEST_HOST': '$(BUILT_PRODUCTS_DIR)/Probe.app/Probe', 'BUNDLE_LOADER': '$(TEST_HOST)'}), buildPhases=['TestsSources', 'TestsFrameworks', 'TestsResources'], buildRules=[], dependencies=['Dependency'], fileSystemSynchronizedGroups=['TestsGroup'])
add(project, 'PBXProject', attributes={'LastUpgradeCheck': '2650', 'TargetAttributes': {tests: {'TestTargetID': app}}}, buildConfigurationList=configs('Project', {}), developmentRegion='en', knownRegions=['en', 'Base'], mainGroup='Main', productRefGroup='Products', projectDirPath='', projectRoot='', targets=[app, tests])
project_dir = out / 'Probe.xcodeproj'
project_dir.mkdir()
(project_dir / 'project.pbxproj').write_bytes(plistlib.dumps({'archiveVersion': '1', 'classes': {}, 'objectVersion': '77', 'objects': objects, 'rootObject': project}))
def ref(identifier, name, product):
    return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{identifier}" BuildableName="{product}" BlueprintName="{name}" ReferencedContainer="container:Probe.xcodeproj"/>'
a, t = ref(app, 'Probe', 'Probe.app'), ref(tests, 'ProbeTests', 'ProbeTests.xctest')
# Absolute path removes ambiguity about scheme-relative configuration resolution.
config = str(out / 'App/Minimal.storekit')
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2650" version="1.7">
<BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">{a}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">{t}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
<MacroExpansion>{a}</MacroExpansion><Testables><TestableReference skipped="NO" parallelizable="NO">{t}</TestableReference></Testables>
<StoreKitConfigurationFileReference identifier="{config}"/>
</TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
<BuildableProductRunnable runnableDebuggingMode="0">{a}</BuildableProductRunnable><StoreKitConfigurationFileReference identifier="{config}"/>
</LaunchAction>
</Scheme>
'''
scheme_dir = project_dir / 'xcshareddata/xcschemes'
scheme_dir.mkdir(parents=True)
(scheme_dir / 'Probe.xcscheme').write_text(scheme)
print(project_dir)
