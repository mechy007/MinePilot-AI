package ai.minepilot.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Bundle;
import android.view.View;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;

/**
 * A lightweight software voxel renderer driven ONLY by decoded Bedrock packet
 * observations. This is a reconstructed approximation, not Minecraft video.
 * No OpenGL context, game process, textures or unverified chunk data required.
 */
public final class FirstPersonVoxelView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float[] blocks = new float[0];   // dx, dy, dz, type, visible-face mask
    private float[] actors = new float[0];   // dx, dy, dz, classification
    private float yaw, pitch, eyeHeight = 1.62f;
    private boolean available;
    private String reason = "Waiting for a first-person scene";
    private final ArrayList<Face> faces = new ArrayList<>(1000);
    private static final float NEAR = 0.15f;
    private static final int[] COLORS = {
        0xff627187, 0xff71533b, 0xff858991, 0xff866044, 0xff447c43,
        0xff2b8caf, 0xffff7e30, 0xffc8b076, 0xff67788b
    };
    // Face vertex indices (west, east, bottom, top, north, south)
    private static final int[][] FACES = {
        {0,2,6,4}, {1,5,7,3}, {0,1,3,2},
        {4,6,7,5}, {0,4,5,1}, {2,3,7,6}
    };
    private static final float[][] VERTICES = {
        {0,0,0},{1,0,0},{0,1,0},{1,1,0},
        {0,0,1},{1,0,1},{0,1,1},{1,1,1}
    };
    private static final class Face {
        final Path path;
        final float depth;
        final int color;
        Face(Path path,float depth,int color) {
            this.path=path;this.depth=depth;this.color=color;
        }
    }
    public FirstPersonVoxelView(Context context) { super(context); }
    public void update(Bundle data) {
        available = "spawned".equals(data.getString("phase","")) &&
                data.getBoolean("fp_available", false);
        if (!available) {
            blocks = new float[0];actors=new float[0];
            reason=data.getString("fp_reason","Waiting for decoded blocks and camera rotation");
        } else {
            float[] next=data.getFloatArray("fp_blocks");
            float[] entities=data.getFloatArray("fp_entities");
            blocks=next!=null && next.length<=720 && next.length%5==0?
                    next.clone():new float[0];
            actors=entities!=null && entities.length<=64 && entities.length%4==0?
                    entities.clone():new float[0];
            yaw=data.getFloat("fp_yaw",0f);
            pitch=Math.max(-89,Math.min(89,data.getFloat("fp_pitch",0f)));
            eyeHeight=1.62f;
            reason="Decoded scene: "+(blocks.length/5)+" voxels";
        }
        invalidate();
    }

    // Minecraft's yaw/pitch are derived from network packets, not from device
    // sensors. Transform into camera space before clipping against the near plane.
    private float[] cameraPoint(float x,float y,float z) {
        double angle=Math.toRadians(yaw);
        float sine=(float)Math.sin(angle), cosine=(float)Math.cos(angle);
        float horizontal=x*cosine+z*sine;
        float forward=-x*sine+z*cosine;
        double tilt=Math.toRadians(pitch);
        return new float[]{horizontal,
                (float)(y*Math.cos(tilt)+forward*Math.sin(tilt)),
                (float)(forward*Math.cos(tilt)-y*Math.sin(tilt))};
    }
    private float[] screenPoint(float[] xyz,float width,float height) {
        if(xyz[2]<NEAR)return null;
        float focal=width*0.94f;
        float px=width/2+xyz[0]*focal/xyz[2];
        float py=height/2-xyz[1]*focal/xyz[2];
        return Float.isFinite(px)&&Float.isFinite(py)?
                new float[]{px,py,xyz[2]}:null;
    }
    private float[] project(float x,float y,float z,float width,float height) {
        return screenPoint(cameraPoint(x,y,z),width,height);
    }
    private static int shade(int color,float ratio) {
        return Color.rgb(Math.min(255,(int)(Color.red(color)*ratio)),
                Math.min(255,(int)(Color.green(color)*ratio)),
                Math.min(255,(int)(Color.blue(color)*ratio)));
    }
    // Sutherland-Hodgman near-plane clipping. V1 dropped the entire face if
    // just one corner was behind the camera, creating large holes up close.
    private static ArrayList<float[]> clipNear(float[][] vertices,int[] indices) {
        ArrayList<float[]> polygon=new ArrayList<>(6);
        for(int id:indices)polygon.add(vertices[id]);
        ArrayList<float[]> clipped=new ArrayList<>(6);
        for(int i=0;i<polygon.size();i++){
            float[] start=polygon.get(i);
            float[] end=polygon.get((i+1)%polygon.size());
            boolean a=start[2]>=NEAR,b=end[2]>=NEAR;
            if(a)clipped.add(start);
            if(a!=b) {
                float fraction=(NEAR-start[2])/(end[2]-start[2]);
                clipped.add(new float[]{
                    start[0]+fraction*(end[0]-start[0]),
                    start[1]+fraction*(end[1]-start[1]),NEAR
                });
            }
        }
        return clipped;
    }
    // Back-face culling uses the viewer's observed position relative to each
    // cube; never draw an opposite face through its own solid geometry.
    private static boolean cameraSeesFace(int face,float bx,float by,float bz) {
        switch(face) {
            case 0:return bx>0f;       // west
            case 1:return bx+1f<0f;    // east
            case 2:return by>0f;       // bottom
            case 3:return by+1f<0f;    // top
            case 4:return bz>0f;       // north
            case 5:return bz+1f<0f;    // south
            default:return false;
        }
    }
    private void buildFaces(int index,float width,float height) {
        float bx=blocks[index],by=blocks[index+1]-eyeHeight,bz=blocks[index+2];
        int type=Math.max(1,Math.min(COLORS.length-1,(int)blocks[index+3]));
        int mask=(int)blocks[index+4];
        float[][] vertices=new float[8][];
        for(int v=0;v<8;v++) {
            float[] corner=VERTICES[v];
            vertices[v]=cameraPoint(bx+corner[0],by+corner[1],bz+corner[2]);
        }
        for(int f=0;f<FACES.length;f++) {
            if((mask&(1<<f))==0||!cameraSeesFace(f,bx,by,bz))continue;
            ArrayList<float[]> clipped=clipNear(vertices,FACES[f]);
            if(clipped.size()<3)continue;
            Path path=new Path();
            float depth=0f;boolean valid=true;
            for(int j=0;j<clipped.size();j++) {
                float[] p=screenPoint(clipped.get(j),width,height);
                if(p==null){valid=false;break;}
                if(j==0)path.moveTo(p[0],p[1]);else path.lineTo(p[0],p[1]);
                depth+=p[2];
            }
            if(!valid)continue;
            path.close();
            float brightness=f==3?1.18f:f==2?0.58f:f==4?0.88f:f==5?0.76f:0.66f;
            faces.add(new Face(path,depth/clipped.size(),shade(COLORS[type],brightness)));
        }
    }
    private void text(Canvas canvas,String message,float x,float y,int color,float size){
        paint.setColor(color);paint.setStyle(Paint.Style.FILL);
        paint.setTextSize(size);
        canvas.drawText(message,x,y,paint);
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w=getWidth(),h=getHeight(),density=getResources().getDisplayMetrics().density;
        canvas.drawColor(0xff172839);
        if(!available){
            text(canvas,"FIRST PERSON · RECONSTRUCTED",12*density,22*density,0xff65e4ad,12*density);
            text(canvas,reason,12*density,h/2,0xffc0cee0,12*density);
            text(canvas,"No synthetic terrain is displayed",12*density,h/2+24*density,
                    0xff9fb0ca,11*density);
            return;
        }

        faces.clear();
        for(int i=0;i+4<blocks.length;i+=5)
            buildFaces(i,w,h);
        // Billboard markers participate in the depth sort. They no longer
        // appear painted over every foreground block regardless of distance.
        for(int i=0;i+3<actors.length;i+=4){
            float[] point=project(actors[i],actors[i+1]-0.65f,actors[i+2],w,h);
            if(point==null||point[0]<0||point[0]>w||point[1]<0||point[1]>h)
                continue;
            int color=actors[i+3]==2?0xffff7585:
                    actors[i+3]==1?0xff70b8ff:0xffffc07a;
            float radius=Math.max(3*density,Math.min(12*density,26*density/point[2]));
            Path marker=new Path();
            marker.addCircle(point[0],point[1],radius,Path.Direction.CW);
            faces.add(new Face(marker,point[2],color));
        }
        Collections.sort(faces,Comparator.comparingDouble((Face face)->face.depth).reversed());
        for(Face face:faces){
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(face.color);
            canvas.drawPath(face.path,paint);
        }
        paint.setColor(0xff65e4ad);
        paint.setStrokeWidth(1.4f*density);
        canvas.drawLine(w/2-8*density,h/2,w/2+8*density,h/2,paint);
        canvas.drawLine(w/2,h/2-8*density,w/2,h/2+8*density,paint);
        paint.setColor(0xff142133);
        paint.setStyle(Paint.Style.FILL);
        canvas.drawRect(0,0,w,37*density,paint);
        text(canvas,"FIRST PERSON  ·  VOXEL RECONSTRUCTION",10*density,15*density,
                0xff65e4ad,11*density);
        text(canvas,"Yaw "+Math.round(yaw)+"° · Pitch "+Math.round(pitch)+
                "°  ·  "+(blocks.length/5)+" observed cubes",10*density,31*density,
                0xffd3dce7,10*density);
        text(canvas,"Unknown blocks hidden · Textures and lighting approximated",
                8*density,h-10*density,0xffcad5e3,9*density);
    }
}
